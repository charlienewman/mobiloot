import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { Keypair, PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import type { Entitlement, ZeroConfig } from '@zero/shared'
import { buildApp, type Deps } from '../src/app'
import { formatSiwsMessage } from '../src/auth'
import { createCoverage } from '../src/coverage'
import { openDb } from '../src/db'
import { MockProvider } from '../src/provider/mock'

const MIN = 500_000_000n
const config: ZeroConfig = {
  admin: PublicKey.default,
  stakePoolProgram: PublicKey.default,
  stakePool: PublicKey.default,
  poolMint: PublicKey.default,
  planCode: 'zero-essentials',
  minStakeLamports: MIN,
  periodSeconds: 2_592_000,
  periodOrigin: 1_788_220_800n,
  paused: false,
}

function setup() {
  const entitled = new Map<string, Entitlement>()
  const holdings = new Map<string, bigint>()
  let providerCalls = 0
  const provider = new MockProvider()
  const create = provider.createOrder.bind(provider)
  provider.createOrder = async (input) => {
    providerCalls++
    return create(input)
  }
  const deps: Deps = {
    db: openDb(':memory:'),
    provider,
    cluster: {
      cluster: 'localnet',
      rpcUrl: 'http://x',
      stakePoolProgram: 'p',
      stakePool: 's',
      poolMint: 'm',
      treasury: 't',
      zeroProgram: 'z',
    },
    signInDomain: 'zero.test',
    fetchZeroConfig: async () => config,
    currentPeriod: async () => 1n,
    fetchEntitlement: async (owner, period) => entitled.get(`${owner.toBase58()}:${period}`),
    fetchHoldings: async (owner) => {
      const l = holdings.get(owner.toBase58()) ?? 0n
      return { poolTokens: l, stakeLamports: l }
    },
    poolStats: async () => ({}) as any,
    solPrice: async () => ({ usd: 150, source: 'test' }),
  }
  const app = buildApp(deps)
  const entitle = (kp: Keypair, stake = MIN) => {
    holdings.set(kp.publicKey.toBase58(), stake)
    entitled.set(`${kp.publicKey.toBase58()}:1`, {
      address: Keypair.generate().publicKey,
      owner: kp.publicKey,
      period: 1n,
      planCode: 'zero-essentials',
      poolTokens: stake,
      stakeLamports: stake,
      activatedAt: 0n,
    })
  }
  return { app, deps, entitle, holdings, calls: () => providerCalls }
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

/** Does what a wallet does with the challenge: format the SIWS message and sign it. */
async function signIn(app: ReturnType<typeof buildApp>, kp: Keypair, overrides: Record<string, string> = {}) {
  const address = kp.publicKey.toBase58()
  const ch = await app.inject({ method: 'POST', url: '/v1/auth/challenge' })
  assert.equal(ch.statusCode, 200)
  const input = { ...ch.json(), ...overrides }
  const message = formatSiwsMessage({ ...input, address })
  return {
    nonce: input.nonce as string,
    message,
    address,
    signedMessage: b64(Buffer.from(message)),
    signature: b64(nacl.sign.detached(Buffer.from(message), kp.secretKey)),
  }
}
const verifyBody = (s: Awaited<ReturnType<typeof signIn>>) => ({
  address: s.address,
  signedMessage: s.signedMessage,
  signature: s.signature,
})

describe('auth', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => (ctx = setup()))

  test('issues a domain-bound challenge and a session for a valid signature', async () => {
    const kp = Keypair.generate()
    const s = await signIn(ctx.app, kp)
    assert.match(s.message, /^zero\.test wants you to sign in/)
    assert.match(s.message, /Chain ID: solana:localnet/)
    assert.match(s.message, new RegExp(`Nonce: ${s.nonce}`))
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(s) })
    assert.equal(res.statusCode, 200)
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${res.json().token}` },
    })
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().address, s.address)
  })

  test('rejects a replayed challenge', async () => {
    const s = await signIn(ctx.app, Keypair.generate())
    assert.equal(
      (await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(s) })).statusCode,
      200,
    )
    const replay = await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(s) })
    assert.equal(replay.statusCode, 401)
    assert.equal(replay.json().error, 'Challenge already used')
  })

  test("rejects a signature from another wallet or for another wallet's challenge", async () => {
    const victim = Keypair.generate()
    const attacker = Keypair.generate()
    const s = await signIn(ctx.app, victim)
    const forged = b64(nacl.sign.detached(Buffer.from(s.message), attacker.secretKey))
    const r1 = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { ...verifyBody(s), signature: forged },
    })
    assert.equal(r1.json().error, 'Invalid signature')
    // Attacker signs the victim's message text with their own key: address line mismatch.
    const r2 = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { address: attacker.publicKey.toBase58(), signedMessage: s.signedMessage, signature: forged },
    })
    assert.equal(r2.json().error, 'Address mismatch')
  })

  test('rejects messages for another domain, chain or an unissued nonce', async () => {
    const kp = Keypair.generate()
    const wrongDomain = await signIn(ctx.app, kp, { domain: 'evil.test' })
    assert.equal(
      (await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(wrongDomain) })).json().error,
      'Wrong domain',
    )
    const wrongChain = await signIn(ctx.app, kp, { chainId: 'solana:mainnet' })
    assert.equal(
      (await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(wrongChain) })).json().error,
      'Wrong chain',
    )
    const madeUp = await signIn(ctx.app, kp, { nonce: 'f'.repeat(32) })
    assert.equal(
      (await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(madeUp) })).json().error,
      'Unknown challenge',
    )
  })

  test('rejects expired challenges', async () => {
    const s = await signIn(ctx.app, Keypair.generate())
    ctx.deps.db.prepare('UPDATE challenges SET expires_at = 0').run()
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(s) })
    assert.equal(res.json().error, 'Challenge expired')
  })

  test('rate-limits sign-in attempts', async () => {
    const codes = []
    for (let i = 0; i < 22; i++)
      codes.push((await ctx.app.inject({ method: 'POST', url: '/v1/auth/challenge' })).statusCode)
    assert.equal(codes.filter((c) => c === 200).length, 20)
    assert.equal(codes.at(-1), 429)
  })

  test('protected routes need a session', async () => {
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/v1/me' })).statusCode, 401)
    assert.equal(
      (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: { authorization: 'Bearer nope' } })).statusCode,
      401,
    )
  })
})

describe('eSIM provisioning', () => {
  let ctx: ReturnType<typeof setup>
  let kp: Keypair
  let auth: { authorization: string }
  beforeEach(async () => {
    ctx = setup()
    kp = Keypair.generate()
    const s = await signIn(ctx.app, kp)
    const token = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: verifyBody(s) })).json()
      .token
    auth = { authorization: `Bearer ${token}` }
  })

  test('refuses without an on-chain entitlement', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    assert.equal(res.statusCode, 403)
    assert.equal(ctx.calls(), 0)
  })

  test('refuses if the wallet withdrew below the plan threshold after activating', async () => {
    ctx.entitle(kp)
    ctx.holdings.set(kp.publicKey.toBase58(), MIN - 1n)
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    assert.equal(res.statusCode, 403)
  })

  test('provisions once and stays idempotent across retries', async () => {
    ctx.entitle(kp)
    const results = await Promise.all(
      [1, 2, 3].map(() => ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })),
    )
    const ids = new Set(results.map((r) => r.json().id))
    assert.equal(ids.size, 1)
    assert.equal(results[0].json().status, 'ready')
    const rows = ctx.deps.db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }
    assert.equal(rows.n, 1)
    const again = await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    assert.equal(again.json().id, results[0].json().id)
  })

  test('masks the activation code unless explicitly revealed', async () => {
    ctx.entitle(kp)
    const order = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })).json()
    assert.equal(order.activationCode, undefined)
    assert.equal(order.hasActivationCode, true)
    const me = (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth })).body
    assert.doesNotMatch(me, /LPA:/)
    const revealed = (await ctx.app.inject({ method: 'POST', url: '/v1/esim/reveal', headers: auth })).json()
    assert.match(revealed.activationCode, /^LPA:1\$/)
    assert.equal(revealed.smdpAddress, 'rsp.mock.zero.invalid')
  })

  test('reports usage for an active eSIM', async () => {
    ctx.entitle(kp)
    await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    const usage = (await ctx.app.inject({ method: 'GET', url: '/v1/usage', headers: auth })).json()
    assert.equal(usage.dataTotalMb, 10 * 1024)
    assert.ok(usage.dataUsedMb >= 0 && usage.dataUsedMb <= usage.dataTotalMb)
  })

  test('a line is suspended while its wallet stops covering the plan, and resumes after', async () => {
    // The relay attack: activate and provision, then hand the zeroSOL to another wallet.
    ctx.entitle(kp)
    await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    ctx.holdings.set(kp.publicKey.toBase58(), 0n)

    const me = (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json()
    assert.equal(me.esim.suspended, true)
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/v1/esim/reveal', headers: auth })).statusCode, 403)
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/v1/usage', headers: auth })).statusCode, 403)
    assert.ok((ctx.deps.provider as MockProvider).suspended.size === 1)

    ctx.holdings.set(kp.publicKey.toBase58(), MIN)
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/v1/esim/reveal', headers: auth })).statusCode, 200)
    assert.equal((ctx.deps.provider as MockProvider).suspended.size, 0)
  })

  test('the background sweep suspends lines without any request from the user', async () => {
    ctx.entitle(kp)
    await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    ctx.holdings.set(kp.publicKey.toBase58(), MIN - 1n)
    const result = await createCoverage(ctx.deps).sweep(1n, MIN)
    assert.deepEqual(result, { checked: 1, changed: 1 })
    const row = ctx.deps.db.prepare('SELECT suspended_at FROM orders').get() as { suspended_at: number | null }
    assert.ok(row.suspended_at)
  })

  test('a provider outage leaves the order retryable', async () => {
    ctx.entitle(kp)
    const create = ctx.deps.provider.createOrder
    ctx.deps.provider.createOrder = async () => {
      throw new Error('boom')
    }
    const failed = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })).json()
    assert.equal(failed.status, 'failed')
    ctx.deps.provider.createOrder = create
    const retried = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })).json()
    assert.equal(retried.status, 'ready')
    assert.equal(retried.id, failed.id)
  })
})
