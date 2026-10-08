import crypto from 'node:crypto'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { PublicKey } from '@solana/web3.js'
import Fastify, { type FastifyRequest } from 'fastify'
import { periodBounds, type Entitlement, type MobilootConfig } from '@mobiloot/shared'
import { z } from 'zod'
import { AuthError, createChallenge, revokeSession, sessionAddress, verifySignIn } from './auth'
import { createCoverage } from './coverage'
import type { Db, OrderRow } from './db'
import { planByCode, PLANS } from './plans'
import type { MobileProvider } from './provider'
import { verifyShakaSignature } from './provider/shaka'
import type { PoolStats } from './stats'

/** Everything the routes need from the outside world, injectable for tests. */
export interface Deps {
  db: Db
  /** Everyone's eSIM provider (the mock), unless their wallet is in `liveWallets`. */
  provider: MobileProvider
  /** Real eSIMs, for allowlisted wallets only. */
  live?: MobileProvider & { noteEvent?(event: Record<string, any>): boolean; reconcileDue?(): Promise<unknown> }
  liveWallets?: Set<string>
  /** Wallets that may order an eSIM without staking (testing only). */
  testWallets?: Set<string>
  shakaWebhookSecret?: string
  cluster: {
    cluster: string
    rpcUrl: string
    stakePoolProgram: string
    stakePool: string
    poolMint: string
    treasury: string
    mobilootProgram?: string
  }
  signInDomain: string
  trustProxy?: boolean
  fetchMobilootConfig(): Promise<MobilootConfig>
  currentPeriod(config: MobilootConfig): Promise<bigint>
  fetchEntitlement(owner: PublicKey, period: bigint): Promise<Entitlement | undefined>
  fetchHoldings(owner: PublicKey): Promise<{ poolTokens: bigint; stakeLamports: bigint }>
  poolStats(): Promise<PoolStats>
  solPrice(): Promise<{ usd: number; source: string }>
}

export function buildApp(deps: Deps) {
  const { db, provider } = deps
  const providerFor = (address: string) => (deps.live && deps.liveWallets?.has(address) ? deps.live : provider)
  const providerByMode = (mode: string) =>
    deps.live?.mode === mode ? deps.live : provider.mode === mode ? provider : undefined
  const testGrant = (address: string) => Boolean(deps.testWallets?.has(address))
  const coverage = createCoverage({ db, providerByMode, fetchHoldings: deps.fetchHoldings, exempt: testGrant })
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Activation codes and session tokens must never reach logs.
      redact: ['req.headers.authorization', '*.activationCode', 'activationCode', 'res.body'],
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: deps.trustProxy ?? false,
  })
  void app.register(cors, { origin: true })
  // Per-IP limits; sign-in and provisioning get tighter ones below.
  void app.register(rateLimit, { max: 240, timeWindow: '1 minute' })
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AuthError) return reply.code(401).send({ error: err.message, requestId: req.id })
    if (err instanceof z.ZodError)
      return reply.code(400).send({
        error: 'Invalid request',
        issues: err.issues,
        requestId: req.id,
      })
    if (err.statusCode === 429)
      return reply.code(429).send({ error: 'Too many requests, slow down', requestId: req.id })
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

  // Routes live in a child plugin so they register after rate-limit's onRoute hook.
  void app.register(async (app) => {
    app.get('/v1/health', async () => ({
      ok: true,
      cluster: deps.cluster.cluster,
      providerMode: provider.mode,
    }))

    app.get('/v1/config', async () => {
      const config = await deps.fetchMobilootConfig()
      const period = await deps.currentPeriod(config)
      const plan = planByCode(config.planCode) ?? PLANS[0]
      return {
        cluster: deps.cluster.cluster,
        rpcUrl: deps.cluster.rpcUrl,
        stakePoolProgram: deps.cluster.stakePoolProgram,
        stakePool: deps.cluster.stakePool,
        poolMint: deps.cluster.poolMint,
        treasury: deps.cluster.treasury,
        mobilootProgram: deps.cluster.mobilootProgram,
        providerMode: provider.mode,
        plan,
        minStakeLamports: config.minStakeLamports.toString(),
        paused: config.paused,
        period: {
          id: period.toString(),
          ...periodBounds(config, period),
          seconds: config.periodSeconds,
        },
        solUsd: await deps.solPrice(),
      }
    })

    app.get('/v1/pool', async () => deps.poolStats())

    /** Fields for a Sign In With Solana request; the wallet formats and signs the message. */
    app.post('/v1/auth/challenge', strict, async () =>
      createChallenge(db, deps.signInDomain, `solana:${deps.cluster.cluster}`),
    )

    app.post('/v1/auth/verify', strict, async (req) => {
      const body = z
        .object({
          address: z.string(),
          signedMessage: z.string(),
          signature: z.string(),
        })
        .parse(req.body)
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
      const config = await deps.fetchMobilootConfig()
      const period = await deps.currentPeriod(config)
      const [entitlement, holdings] = await Promise.all([
        deps.fetchEntitlement(owner, period),
        deps.fetchHoldings(owner),
      ])
      const found = await refreshOrder(findOrder(owner.toBase58(), period))
      const order = found && (await coverage.apply(found, holdings.stakeLamports, config.minStakeLamports))
      return {
        address: owner.toBase58(),
        liveEsim: providerFor(owner.toBase58()) !== provider,
        testGrant: testGrant(owner.toBase58()),
        period: period.toString(),
        holdings: {
          poolTokens: holdings.poolTokens.toString(),
          stakeLamports: holdings.stakeLamports.toString(),
        },
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
    app.post('/v1/esim', strict, async (req) => {
      const owner = requireWallet(req)
      const config = await deps.fetchMobilootConfig()
      const period = await deps.currentPeriod(config)
      const address = owner.toBase58()
      const entitlement = await deps.fetchEntitlement(owner, period)
      const holdings = await deps.fetchHoldings(owner)
      // A test grant stands in for the on-chain entitlement and the stake behind it.
      if (!testGrant(address)) {
        if (!entitlement || !entitlement.owner.equals(owner))
          throw new HttpError(403, 'No active plan for this period. Activate it first.')
        if (holdings.stakeLamports < config.minStakeLamports)
          throw new HttpError(403, 'Your lootSOL balance no longer covers the plan.')
      }

      const lineProvider = providerFor(address)
      const existing = await refreshOrder(findOrder(address, period))
      if (existing?.status === 'ready')
        return publicOrder(await coverage.apply(existing, holdings.stakeLamports, config.minStakeLamports))

      const now = Date.now()
      const id = existing?.id ?? crypto.randomUUID()
      if (!existing) {
        db.prepare(
          `INSERT OR IGNORE INTO orders (id, address, period, plan_code, entitlement, provider_mode, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(
          id,
          address,
          Number(period),
          entitlement?.planCode ?? PLANS[0].code,
          entitlement?.address.toBase58() ?? 'test-grant',
          lineProvider.mode,
          now,
          now,
        )
      }
      const row = findOrder(address, period)!
      try {
        const result = await lineProvider.createOrder({
          owner: address,
          planCode: row.plan_code,
          idempotencyKey: `${address}:${period}`,
        })
        saveResult(row, result)
      } catch (e: any) {
        req.log.warn({ err: e.message, order: row.id }, 'provider order failed')
        db.prepare(`UPDATE orders SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(
          'Provider unavailable, try again',
          Date.now(),
          row.id,
        )
      }
      const saved = findOrder(address, period)!
      return publicOrder(await coverage.apply(saved, holdings.stakeLamports, config.minStakeLamports))
    })

    /** Returns the secret activation code. Only on explicit request, never logged. */
    app.post('/v1/esim/reveal', strict, async (req) => {
      const owner = requireWallet(req)
      const config = await deps.fetchMobilootConfig()
      const order = await coveredOrder(owner, config)
      if (order?.status !== 'ready') throw new HttpError(404, 'No eSIM ready yet')
      if (order.activation_code) {
        return {
          activationCode: order.activation_code,
          ...splitLpa(order.activation_code),
          androidInstallUrl: androidInstallUrl(order.activation_code),
          msisdn: null,
        }
      }
      const p = providerByMode(order.provider_mode)
      if (!p?.getActivation || !order.provider_order_id) throw new HttpError(404, 'No eSIM ready yet')
      try {
        return await p.getActivation(order.provider_order_id)
      } catch (e: any) {
        req.log.warn({ err: e.message, order: order.id }, 'activation fetch failed')
        throw new HttpError(503, 'Could not fetch your eSIM details right now, try again')
      }
    })

    app.get('/v1/usage', async (req) => {
      const owner = requireWallet(req)
      const config = await deps.fetchMobilootConfig()
      const order = await coveredOrder(owner, config)
      if (!order?.provider_order_id || order.status !== 'ready') throw new HttpError(404, 'No active eSIM')
      const plan = planByCode(order.plan_code) ?? PLANS[0]
      const p = providerByMode(order.provider_mode)
      if (!p) throw new HttpError(404, 'No active eSIM')
      try {
        return await p.getUsage(order.provider_order_id, plan.dataGb === 'unlimited' ? null : plan.dataGb * 1024)
      } catch (e: any) {
        req.log.warn({ err: e.message, order: order.id }, 'usage fetch failed')
        throw new HttpError(503, 'Usage is unavailable right now')
      }
    })
  })

  // Shaka webhooks. Signed over the raw bytes, so this scope keeps the body unparsed.
  void app.register(async (app) => {
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
    app.post('/v1/webhooks/shaka', async (req, reply) => {
      const secret = deps.shakaWebhookSecret
      if (!secret || !deps.live) return reply.code(404).send({ error: 'Not found' })
      const raw = req.body
      if (!Buffer.isBuffer(raw)) return reply.code(400).send({ error: 'Expected JSON' })
      if (!verifyShakaSignature(raw, req.headers['shaka-signature'] as string | undefined, secret))
        return reply.code(401).send({ error: 'Bad signature' })
      let event: any
      try {
        event = JSON.parse(raw.toString('utf8'))
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON' })
      }
      if (typeof event?.idempotency_id !== 'string') return reply.code(400).send({ error: 'Missing idempotency_id' })
      // Keep only what dedupe needs. A storage failure surfaces as 500 so Shaka retries.
      const fresh =
        db
          .prepare(
            'INSERT OR IGNORE INTO shaka_events (idempotency_id, event_type, subscription_id, ours, received_at) VALUES (?, ?, ?, 0, ?)',
          )
          .run(
            event.idempotency_id,
            typeof event.event_type === 'string' ? event.event_type.slice(0, 64) : null,
            Number.isInteger(event.subscription_id) ? event.subscription_id : null,
            Date.now(),
          ).changes > 0
      if (fresh) {
        // A valid signature proves Shaka sent it, not that the line is ours: noteEvent only
        // schedules a canonical re-read of a line we own, and ignores everything else.
        const ours = deps.live.noteEvent?.({
          subscription_id: event.subscription_id,
          journey_id: event.journey_id,
          subscription_reference_id: event.subscription_reference_id,
        })
        if (ours) {
          db.prepare('UPDATE shaka_events SET ours = 1 WHERE idempotency_id = ?').run(event.idempotency_id)
          void deps.live.reconcileDue?.().catch(() => {})
        }
      }
      return { ok: true }
    })
  })

  /** Copies a provider result onto the order row. */
  function saveResult(row: OrderRow, result: Awaited<ReturnType<MobileProvider['getOrder']>>) {
    db.prepare(
      `UPDATE orders SET provider_order_id = ?, status = ?, iccid = ?, activation_code = ?, error = ?,
         suspended_at = CASE WHEN ? THEN COALESCE(suspended_at, ?) ELSE suspended_at END, updated_at = ? WHERE id = ?`,
    ).run(
      result.providerOrderId,
      result.status,
      result.iccid ?? null,
      result.activationCode ?? null,
      result.status === 'failed' ? (result.error ?? 'The eSIM order failed') : null,
      // A live line carries over between periods, including a coverage suspension.
      result.suspended ? 1 : 0,
      Date.now(),
      Date.now(),
      row.id,
    )
  }

  /** Brings a pending order up to date with its provider. */
  async function refreshOrder(row: OrderRow | undefined) {
    if (row?.status !== 'pending' || !row.provider_order_id) return row
    const p = providerByMode(row.provider_mode)
    if (!p) return row
    try {
      saveResult(row, await p.getOrder(row.provider_order_id))
    } catch {
      return row
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id) as unknown as OrderRow
  }

  /** The caller's current order after re-checking coverage; refuses suspended lines. */
  async function coveredOrder(owner: PublicKey, config: MobilootConfig) {
    const order = findOrder(owner.toBase58(), await deps.currentPeriod(config))
    if (!order) return undefined
    const { stakeLamports } = await deps.fetchHoldings(owner)
    const checked = await coverage.apply(order, stakeLamports, config.minStakeLamports)
    if (checked.suspended_at) throw new HttpError(403, 'Line suspended: your lootSOL no longer covers the plan.')
    return checked
  }

  function findOrder(address: string, period: bigint): OrderRow | undefined {
    return db
      .prepare('SELECT * FROM orders WHERE address = ? AND period = ? AND provider_mode = ?')
      .get(address, Number(period), providerFor(address).mode) as OrderRow | undefined
  }

  return Object.assign(app, { refreshOrder })
}

function publicOrder(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    providerMode: o.provider_mode,
    planCode: o.plan_code,
    iccidLast4: o.iccid?.slice(-4) ?? null,
    hasActivationCode: o.status === 'ready',
    suspended: Boolean(o.suspended_at),
    error: o.error,
    createdAt: o.created_at,
  }
}

/** Google's link that opens Android's eSIM installer with this code filled in. */
const androidInstallUrl = (lpa: string) =>
  `https://esimsetup.android.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}`

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
