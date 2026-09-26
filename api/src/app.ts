import crypto from 'node:crypto'
import cors from '@fastify/cors'
import { PublicKey } from '@solana/web3.js'
import Fastify, { type FastifyRequest } from 'fastify'
import { periodBounds, type Entitlement, type ZeroConfig } from '@zero/shared'
import { z } from 'zod'
import { AuthError, createChallenge, revokeSession, sessionAddress, verifySignIn } from './auth'
import type { Db, OrderRow } from './db'
import { planByCode, PLANS } from './plans'
import type { MobileProvider } from './provider'
import type { PoolStats } from './stats'

/** Everything the routes need from the outside world, injectable for tests. */
export interface Deps {
  db: Db
  provider: MobileProvider
  cluster: { cluster: string; rpcUrl: string; stakePoolProgram: string; stakePool: string; poolMint: string; treasury: string; zeroProgram?: string }
  signInDomain: string
  fetchZeroConfig(): Promise<ZeroConfig>
  currentPeriod(config: ZeroConfig): Promise<bigint>
  fetchEntitlement(owner: PublicKey, period: bigint): Promise<Entitlement | undefined>
  fetchHoldings(owner: PublicKey): Promise<{ poolTokens: bigint; stakeLamports: bigint }>
  poolStats(): Promise<PoolStats>
  solPrice(): Promise<{ usd: number; source: string }>
}

export function buildApp(deps: Deps) {
  const { db, provider } = deps
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Activation codes and session tokens must never reach logs.
      redact: ['req.headers.authorization', '*.activationCode', 'activationCode', 'res.body'],
    },
    genReqId: () => crypto.randomUUID(),
  })
  void app.register(cors, { origin: true })

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AuthError) return reply.code(401).send({ error: err.message, requestId: req.id })
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: err.issues, requestId: req.id })
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, requestId: req.id })
    req.log.error({ err: err.message }, 'unhandled error')
    return reply.code(500).send({ error: 'Something went wrong', requestId: req.id })
  })

  const bearer = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer\s+/i, '')
  const requireWallet = (req: FastifyRequest) => {
    const address = sessionAddress(db, bearer(req))
    if (!address) throw new HttpError(401, 'Sign in first')
    return new PublicKey(address)
  }

  app.get('/v1/health', async () => ({ ok: true, cluster: deps.cluster.cluster, providerMode: provider.mode }))

  app.get('/v1/config', async () => {
    const config = await deps.fetchZeroConfig()
    const period = await deps.currentPeriod(config)
    const plan = planByCode(config.planCode) ?? PLANS[0]
    return {
      cluster: deps.cluster.cluster,
      rpcUrl: deps.cluster.rpcUrl,
      stakePoolProgram: deps.cluster.stakePoolProgram,
      stakePool: deps.cluster.stakePool,
      poolMint: deps.cluster.poolMint,
      treasury: deps.cluster.treasury,
      zeroProgram: deps.cluster.zeroProgram,
      providerMode: provider.mode,
      plan,
      minStakeLamports: config.minStakeLamports.toString(),
      paused: config.paused,
      period: { id: period.toString(), ...periodBounds(config, period), seconds: config.periodSeconds },
      solUsd: await deps.solPrice(),
    }
  })

  app.get('/v1/pool', async () => deps.poolStats())

  /** Fields for a Sign In With Solana request; the wallet formats and signs the message. */
  app.post('/v1/auth/challenge', async () => createChallenge(db, deps.signInDomain, `solana:${deps.cluster.cluster}`))

  app.post('/v1/auth/verify', async (req) => {
    const body = z.object({ address: z.string(), signedMessage: z.string(), signature: z.string() }).parse(req.body)
    return verifySignIn(db, body, deps.signInDomain)
  })

  app.post('/v1/auth/logout', async (req) => {
    const token = bearer(req)
    if (token) revokeSession(db, token)
    return { ok: true }
  })

  /** Everything the Home screen needs in one round trip. */
  app.get('/v1/me', async (req) => {
    const owner = requireWallet(req)
    const config = await deps.fetchZeroConfig()
    const period = await deps.currentPeriod(config)
    const [entitlement, holdings] = await Promise.all([deps.fetchEntitlement(owner, period), deps.fetchHoldings(owner)])
    const order = findOrder(owner.toBase58(), period)
    return {
      address: owner.toBase58(),
      period: period.toString(),
      holdings: { poolTokens: holdings.poolTokens.toString(), stakeLamports: holdings.stakeLamports.toString() },
      entitlement: entitlement && {
        address: entitlement.address.toBase58(),
        period: entitlement.period.toString(),
        planCode: entitlement.planCode,
        stakeLamports: entitlement.stakeLamports.toString(),
        activatedAt: Number(entitlement.activatedAt),
      },
      esim: order && publicOrder(order),
    }
  })

  /**
   * Provisions the eSIM for the caller's current-period entitlement. Idempotent: one
   * order per (wallet, period, provider), so retries and double taps are harmless.
   */
  app.post('/v1/esim', async (req) => {
    const owner = requireWallet(req)
    const config = await deps.fetchZeroConfig()
    const period = await deps.currentPeriod(config)
    const entitlement = await deps.fetchEntitlement(owner, period)
    if (!entitlement || !entitlement.owner.equals(owner)) throw new HttpError(403, 'No active plan for this period. Activate it first.')
    const holdings = await deps.fetchHoldings(owner)
    if (holdings.stakeLamports < config.minStakeLamports) throw new HttpError(403, 'Your zeroSOL balance no longer covers the plan.')

    const address = owner.toBase58()
    const existing = findOrder(address, period)
    if (existing?.status === 'ready') return publicOrder(existing)

    const now = Date.now()
    const id = existing?.id ?? crypto.randomUUID()
    if (!existing) {
      db.prepare(
        `INSERT OR IGNORE INTO orders (id, address, period, plan_code, entitlement, provider_mode, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(id, address, Number(period), entitlement.planCode, entitlement.address.toBase58(), provider.mode, now, now)
    }
    const row = findOrder(address, period)!
    try {
      const result = await provider.createOrder({ planCode: row.plan_code, idempotencyKey: `${address}:${period}` })
      db.prepare(
        `UPDATE orders SET provider_order_id = ?, status = ?, iccid = ?, activation_code = ?, error = NULL, updated_at = ? WHERE id = ?`,
      ).run(result.providerOrderId, result.status, result.iccid ?? null, result.activationCode ?? null, Date.now(), row.id)
    } catch (e: any) {
      req.log.warn({ err: e.message, order: row.id }, 'provider order failed')
      db.prepare(`UPDATE orders SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run('Provider unavailable, try again', Date.now(), row.id)
    }
    return publicOrder(findOrder(address, period)!)
  })

  /** Returns the secret activation code. Only on explicit request, never logged. */
  app.post('/v1/esim/reveal', async (req) => {
    const owner = requireWallet(req)
    const config = await deps.fetchZeroConfig()
    const order = findOrder(owner.toBase58(), await deps.currentPeriod(config))
    if (!order?.activation_code) throw new HttpError(404, 'No eSIM ready yet')
    return { activationCode: order.activation_code, ...splitLpa(order.activation_code) }
  })

  app.get('/v1/usage', async (req) => {
    const owner = requireWallet(req)
    const config = await deps.fetchZeroConfig()
    const order = findOrder(owner.toBase58(), await deps.currentPeriod(config))
    if (!order?.provider_order_id || order.status !== 'ready') throw new HttpError(404, 'No active eSIM')
    const plan = planByCode(order.plan_code) ?? PLANS[0]
    return provider.getUsage(order.provider_order_id, plan.dataGb * 1024)
  })

  function findOrder(address: string, period: bigint): OrderRow | undefined {
    return db
      .prepare('SELECT * FROM orders WHERE address = ? AND period = ? AND provider_mode = ?')
      .get(address, Number(period), provider.mode) as OrderRow | undefined
  }

  return app
}

function publicOrder(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    providerMode: o.provider_mode,
    planCode: o.plan_code,
    iccidLast4: o.iccid?.slice(-4) ?? null,
    hasActivationCode: Boolean(o.activation_code),
    error: o.error,
    createdAt: o.created_at,
  }
}

/** LPA:1$<SM-DP+ address>$<matching id> → parts for manual entry in Android settings. */
function splitLpa(code: string) {
  const [, smdp, matchingId] = code.split('$')
  return { smdpAddress: smdp ?? null, matchingId: matchingId ?? null }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
