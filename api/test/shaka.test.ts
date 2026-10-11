import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { beforeEach, describe, test } from 'node:test'
import { Keypair, PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import type { Entitlement, MobilootConfig } from '@mobiloot/shared'
import { buildApp } from '../src/app'
import { formatSiwsMessage } from '../src/auth'
import { createCoverage } from '../src/coverage'
import { openDb, type Db } from '../src/db'
import { MockProvider } from '../src/provider/mock'
import { ShakaLiveProvider, verifyShakaSignature } from '../src/provider/shaka'

const BASE = 'https://nexus.example.test/api/v0-0-0'
const OWNER = Keypair.generate().publicKey.toBase58()

/**
 * An in-memory Shaka with the behaviours that matter: Api-Key auth, idempotency keys
 * (a same-key replay answers 409 with the original id), pagination, journeys that
 * complete when told to, and suspension journeys.
 */
class FakeShaka {
  calls: { method: string; path: string; key?: string }[] = []
  subscribers: any[] = []
  subscriptions: any[] = []
  journeys = new Map<string, { kind: string; status: string; subscriptionId?: number }>()
  orderBodies: any[] = []
  replays = new Map<string, any>()
  pageSize = 2
  /** New subscriptions start inactive until activate() unless this is set. */
  instantActivation = true
  /** Next responses to force, e.g. a timeout after the server has done the work. */
  faults: ((method: string, path: string) => 'timeout-after' | number | undefined)[] = []
  private nextId = 100

  fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const path = url.pathname.replace('/api/v0-0-0/', '')
    const key = init.headers?.['Idempotency-Key']
    this.calls.push({ method, path, key })
    if (init.headers?.Authorization !== 'Api-Key test-key') return json(401, { detail: 'bad key' })
    // Each fault fires once, on the first request it matches.
    let fault: ReturnType<FakeShaka['faults'][number]>
    const i = this.faults.findIndex((f) => (fault = f(method, path)) !== undefined)
    if (i >= 0) this.faults.splice(i, 1)
    if (typeof fault === 'number') return json(fault, { detail: 'forced' })
    const body = init.body ? JSON.parse(init.body) : undefined
    const res = this.handle(method, path, url.searchParams, body, key)
    if (fault === 'timeout-after') throw new TypeError('fetch failed')
    return res
  }) as typeof fetch

  private handle(method: string, path: string, q: URLSearchParams, body: any, key?: string): Response {
    if (method === 'POST' && key && this.replays.has(key)) return json(409, this.replays.get(key))
    if (method === 'GET' && path === 'data/subscribers/')
      return this.page(
        this.subscribers.filter((s) => !q.get('reference_id') || s.reference_id === q.get('reference_id')),
        q,
      )
    if (method === 'POST' && path === 'data/subscribers/') {
      const s = { id: this.nextId++, ...body, join_date: '2026-10-08' }
      this.subscribers.push(s)
      this.replays.set(key!, { id: s.id })
      return json(201, s)
    }
    if (method === 'GET' && path === 'data/subscriptions/')
      return this.page(
        this.subscriptions.filter(
          (s) =>
            (!q.get('subscriber_id') || String(s.subscriber) === q.get('subscriber_id')) &&
            (!q.get('reference_id') || s.reference_id === q.get('reference_id')),
        ),
        q,
      )
    if (method === 'POST' && path === 'journey/new-subscription/') {
      this.orderBodies.push(body)
      const journeyId = crypto.randomUUID()
      const id = this.nextId++
      this.subscriptions.push({
        id,
        subscriber: body.subscriber_id,
        reference_id: body.reference_id,
        status: this.instantActivation ? 'active' : 'inactive',
        current_msisdn: '447700900123',
        journeys: { created_by: journeyId, suspension: null },
        current_sim: {
          serial_number: '8944000000000000017',
          sim_type: 'esim',
          status: this.instantActivation ? 'active' : 'activating',
          esim_data: {
            sm_dp_address: 'smdp.example.test',
            activation_code: 'K2-SECRET-CODE',
            android_activation_data: '',
            qr_code_base64: '',
          },
        },
      })
      this.journeys.set(journeyId, {
        kind: 'new-subscription',
        status: this.instantActivation ? 'completed' : 'in_progress',
        subscriptionId: id,
      })
      this.replays.set(key!, { journey_id: journeyId })
      return json(201, { journey_id: journeyId })
    }
    const sub = path.match(/^data\/subscriptions\/(\d+)\/(usage\/)?$/)
    if (method === 'GET' && sub) {
      const s = this.subscriptions.find((x) => x.id === Number(sub[1]))
      if (!s) return json(404, {})
      if (sub[2])
        return json(200, {
          local: { data: { used: 3 * 1_048_576, remaining: null }, voice: { used: 120 }, sms: { used: 4 } },
          eu: {},
          row: {},
        })
      return json(200, s)
    }
    const journey = path.match(/^journey\/([a-z-]+)\/([0-9a-f-]+)\/$/)
    if (method === 'GET' && journey) {
      const j = this.journeys.get(journey[2])
      return j
        ? json(200, { status: j.status, failure_reason: j.status === 'failed' ? 'no stock' : '' })
        : json(404, {})
    }
    const susp = path.match(/^journey\/(suspend-sim|unsuspend-sim)\/$/)
    if (method === 'POST' && susp) {
      const s = this.subscriptions.find((x) => x.id === body.subscription_id)
      const need = susp[1] === 'suspend-sim' ? 'active' : 'suspended'
      if (!s || s.current_sim.status !== need) return json(409, { detail: 'wrong state' })
      const journeyId = crypto.randomUUID()
      this.journeys.set(journeyId, { kind: susp[1], status: 'requested', subscriptionId: s.id })
      s.journeys.suspension = journeyId
      this.replays.set(key!, { journey_id: journeyId })
      return json(201, { journey_id: journeyId })
    }
    return json(404, { detail: `no route ${method} ${path}` })
  }

  /** Finishes every in-flight journey, as the network eventually would. */
  completeJourneys() {
    for (const j of this.journeys.values()) {
      if (j.status === 'completed' || j.status === 'failed') continue
      const s = this.subscriptions.find((x) => x.id === j.subscriptionId)
      if (j.kind === 'new-subscription') {
        s.status = 'active'
        s.current_sim.status = 'active'
      } else {
        s.current_sim.status = j.kind === 'suspend-sim' ? 'suspended' : 'active'
        s.journeys.suspension = null
      }
      j.status = 'completed'
    }
  }

  posts(path: string) {
    return this.calls.filter((c) => c.method === 'POST' && c.path === path)
  }

  private page(items: any[], q: URLSearchParams) {
    const page = Number(q.get('page') ?? 1)
    const slice = items.slice((page - 1) * this.pageSize, page * this.pageSize)
    let next: string | null = null
    if (page * this.pageSize < items.length) {
      const params = new URLSearchParams(q)
      params.set('page', String(page + 1))
      next = `${BASE}/${this.calls.at(-1)!.path}?${params}`
    }
    return json(200, { count: items.length, next, previous: null, results: slice })
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function makeProvider(db: Db, shaka: FakeShaka, now = () => Date.now(), extra: { adultServices?: boolean } = {}) {
  return new ShakaLiveProvider(db, {
    ...extra,
    baseUrl: BASE,
    apiKey: 'test-key',
    planId: 58,
    referencePrefix: 'mobiloot-test',
    fetch: shaka.fetch,
    now,
  })
}

describe('Shaka live provider', () => {
  let db: Db
  let shaka: FakeShaka
  let clock: number
  let live: ShakaLiveProvider
  beforeEach(() => {
    db = openDb(':memory:')
    shaka = new FakeShaka()
    clock = 1_800_000_000_000
    live = makeProvider(db, shaka, () => clock)
  })

  test('asks for adult services off by default, or on to match pre-activated eSIMs', async () => {
    await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'a' })
    assert.equal(shaka.orderBodies.at(-1).adult_services_enabled, false)
    const fast = makeProvider(openDb(':memory:'), shaka, () => clock, { adultServices: true })
    await fast.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'b' })
    assert.equal(shaka.orderBodies.at(-1).adult_services_enabled, true)
  })

  test('provisions one eSIM and reuses the line for later periods', async () => {
    const first = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: `${OWNER}:1` })
    assert.equal(first.status, 'ready')
    assert.equal(first.iccid, '8944000000000000017')
    assert.equal(first.activationCode, undefined, 'installation secrets are not handed back for storage')
    const again = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: `${OWNER}:2` })
    assert.equal(again.providerOrderId, first.providerOrderId)
    assert.equal(shaka.posts('data/subscribers/').length, 1)
    assert.equal(shaka.posts('journey/new-subscription/').length, 1)
    const sub = shaka.subscriptions[0]
    assert.match(sub.reference_id, /^mobiloot-test-line-/)
    assert.equal(shaka.subscribers[0].reference_id, `mobiloot-test-wallet-${OWNER}`)
  })

  test('a timeout after Shaka accepted the order recovers the same journey', async () => {
    shaka.faults.push((m, p) => (m === 'POST' && p === 'journey/new-subscription/' ? 'timeout-after' : undefined))
    const first = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    assert.equal(first.status, 'pending')
    clock += 60_000
    const later = await live.getOrder(first.providerOrderId)
    assert.equal(later.status, 'ready')
    assert.equal(shaka.subscriptions.length, 1, 'exactly one eSIM allocated')
    const keys = shaka.posts('journey/new-subscription/').map((c) => c.key)
    assert.ok(keys.length >= 1 && new Set(keys).size === 1, 'every attempt reused the same idempotency key')
  })

  test('a same-key replay answered with 409 adopts the original journey', async () => {
    shaka.instantActivation = false
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    // Lose the saved journey and subscription, as a crash between send and save would.
    db.prepare('UPDATE shaka_lines SET journey_id = NULL, subscription_id = NULL').run()
    shaka.subscriptions[0].reference_id = 'not-propagated'
    clock += 60_000
    await live.getOrder(order.providerOrderId)
    const line = live.line(order.providerOrderId)!
    assert.equal(line.journey_id, shaka.subscriptions[0].journeys.created_by)
    assert.equal(line.subscription_id, shaka.subscriptions[0].id, 'found by its creating journey')
    assert.equal(shaka.subscriptions.length, 1)
  })

  test('stays pending until the eSIM is active, then becomes ready', async () => {
    shaka.instantActivation = false
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    assert.equal(order.status, 'pending')
    clock += 10_000
    assert.equal((await live.getOrder(order.providerOrderId)).status, 'pending')
    shaka.completeJourneys()
    clock += 10_000
    assert.equal((await live.getOrder(order.providerOrderId)).status, 'ready')
  })

  test('a failed journey fails the order with its reason', async () => {
    shaka.instantActivation = false
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    for (const j of shaka.journeys.values()) j.status = 'failed'
    clock += 10_000
    const failed = await live.getOrder(order.providerOrderId)
    assert.equal(failed.status, 'failed')
    assert.match(failed.error!, /failed: no stock/)
  })

  test('walks every page and refuses an ambiguous subscriber match', async () => {
    shaka.pageSize = 1
    for (let i = 0; i < 3; i++) shaka.subscribers.push({ id: i + 1, reference_id: `other-${i}`, name: 'x', email: 'x' })
    shaka.subscribers.push({ id: 50, reference_id: `mobiloot-test-wallet-${OWNER}` })
    shaka.subscribers.push({ id: 51, reference_id: `mobiloot-test-wallet-${OWNER}` })
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    assert.equal(order.status, 'failed')
    assert.equal(live.line(order.providerOrderId)!.state, 'needs_review')
    assert.equal(shaka.posts('journey/new-subscription/').length, 0)
  })

  test('adopts an existing subscriber with this wallet reference instead of creating one', async () => {
    shaka.subscribers.push({ id: 77, reference_id: `mobiloot-test-wallet-${OWNER}`, name: 'x', email: 'x' })
    await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    assert.equal(shaka.posts('data/subscribers/').length, 0)
    assert.equal(shaka.subscriptions[0].subscriber, 77)
  })

  test('a rejected API key stops the line without retrying mutations', async () => {
    const bad = new ShakaLiveProvider(db, {
      baseUrl: BASE,
      apiKey: 'wrong',
      planId: 58,
      referencePrefix: 'mobiloot-test',
      fetch: shaka.fetch,
    })
    const order = await bad.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    assert.equal(order.status, 'failed')
    assert.equal(bad.line(order.providerOrderId)!.state, 'needs_review')
    assert.equal(await bad.reconcileDue(), 0)
  })

  test('5xx and 429 retry later with the same identity', async () => {
    shaka.faults.push(() => 503)
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    assert.equal(order.status, 'pending')
    const line = live.line(order.providerOrderId)!
    assert.ok(line.next_check_at > clock)
    assert.equal(await live.reconcileDue(), 0, 'not due yet')
    clock = line.next_check_at
    assert.equal(await live.reconcileDue(), 1)
    assert.equal((await live.getOrder(order.providerOrderId)).status, 'ready')
  })

  test("never adopts a subscription that isn't this line's", async () => {
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    shaka.subscriptions[0].subscriber = 999
    clock += 10 * 60_000
    const checked = await live.getOrder(order.providerOrderId)
    assert.equal(checked.status, 'failed')
    assert.equal(live.line(order.providerOrderId)!.state, 'needs_review')
  })

  test('refuses a physical SIM', async () => {
    shaka.instantActivation = false
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    shaka.subscriptions[0].current_sim.sim_type = 'physical'
    clock += 10_000
    assert.equal((await live.getOrder(order.providerOrderId)).status, 'failed')
  })

  test('fetches installation details on demand, with an Android install link', async () => {
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    const a = await live.getActivation(order.providerOrderId)
    assert.equal(a.activationCode, 'LPA:1$smdp.example.test$K2-SECRET-CODE')
    assert.equal(a.smdpAddress, 'smdp.example.test')
    assert.equal(a.matchingId, 'K2-SECRET-CODE')
    assert.equal(
      a.androidInstallUrl,
      'https://esimsetup.android.com/esim_qrcode_provisioning?carddata=LPA%3A1%24smdp.example.test%24K2-SECRET-CODE',
    )
    const stored = JSON.stringify(db.prepare('SELECT * FROM shaka_lines').all())
    assert.ok(!stored.includes('K2-SECRET-CODE'), 'the activation code is never persisted')
  })

  test('maps usage, with null remaining meaning unlimited', async () => {
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    const u = await live.getUsage(order.providerOrderId, null)
    assert.deepEqual(
      { ...u, updatedAt: undefined },
      { dataUsedMb: 3, dataTotalMb: null, minutesUsed: 2, textsUsed: 4, updatedAt: undefined },
    )
  })

  test('suspends and resumes through one journey each, however often coverage asks', async () => {
    const order = await live.createOrder({ owner: OWNER, planCode: 'loot-essentials', idempotencyKey: 'k' })
    await live.suspend(order.providerOrderId)
    await live.suspend(order.providerOrderId)
    clock += 30_000
    await live.reconcileDue()
    assert.equal(shaka.posts('journey/suspend-sim/').length, 1)
    shaka.completeJourneys()
    clock += 30_000
    await live.reconcileDue()
    assert.equal(live.line(order.providerOrderId)!.sim_status, 'suspended')
    assert.equal((await live.getOrder(order.providerOrderId)).suspended, true)
    await live.resume(order.providerOrderId)
    shaka.completeJourneys()
    clock += 30_000
    await live.reconcileDue()
    clock += 30_000
    await live.reconcileDue()
    assert.equal(shaka.posts('journey/unsuspend-sim/').length, 1)
    assert.equal(live.line(order.providerOrderId)!.sim_status, 'active')
  })
})

describe('Shaka webhook signatures', () => {
  const secret = 'whsec_test'
  const body = Buffer.from('{"idempotency_id":"e1"}')
  const sign = (t: number, raw = body) =>
    `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex')}`
  const now = 1_800_000_000_000
  const t = now / 1000

  test('accepts a valid signature over the raw bytes', () =>
    assert.ok(verifyShakaSignature(body, sign(t), secret, now)))
  test('rejects a missing or malformed header', () => {
    assert.ok(!verifyShakaSignature(body, undefined, secret, now))
    assert.ok(!verifyShakaSignature(body, 'v1=abc', secret, now))
  })
  test('rejects an altered body', () =>
    assert.ok(!verifyShakaSignature(Buffer.from('{"idempotency_id":"e2"}'), sign(t), secret, now)))
  test('accepts a delayed retry that kept its original timestamp', () =>
    assert.ok(verifyShakaSignature(body, sign(t - 6 * 3600), secret, now)))
  test('rejects expired and future timestamps', () => {
    assert.ok(!verifyShakaSignature(body, sign(t - 4 * 86_400), secret, now))
    assert.ok(!verifyShakaSignature(body, sign(t + 3600), secret, now))
  })
})

describe('live eSIMs in the API', () => {
  const MIN = 500_000_000n
  const config: MobilootConfig = {
    admin: PublicKey.default,
    stakePoolProgram: PublicKey.default,
    stakePool: PublicKey.default,
    poolMint: PublicKey.default,
    planCode: 'loot-essentials',
    minStakeLamports: MIN,
    periodSeconds: 2_592_000,
    periodOrigin: 1_788_220_800n,
    paused: false,
  }
  const secret = 'whsec_test'
  const liveKp = Keypair.generate()
  const mockKp = Keypair.generate()
  let ctx: ReturnType<typeof setup>

  function setup() {
    const db = openDb(':memory:')
    const shaka = new FakeShaka()
    const live = makeProvider(db, shaka)
    const holdings = new Map<string, bigint>()
    let period = 1n
    const deps = {
      db,
      provider: new MockProvider(),
      live,
      liveWallets: new Set([liveKp.publicKey.toBase58()]),
      shakaWebhookSecret: secret,
      cluster: {
        cluster: 'localnet',
        rpcUrl: 'http://x',
        stakePoolProgram: 'p',
        stakePool: 's',
        poolMint: 'm',
        treasury: 't',
      },
      signInDomain: 'mobiloot.test',
      fetchMobilootConfig: async () => config,
      currentPeriod: async () => period,
      fetchEntitlement: async (owner: PublicKey, p: bigint) =>
        (holdings.get(owner.toBase58()) ?? 0n) >= MIN
          ? ({
              address: Keypair.generate().publicKey,
              owner,
              period: p,
              planCode: 'loot-essentials',
              stakeLamports: MIN,
              activatedAt: 0n,
            } as unknown as Entitlement)
          : undefined,
      fetchHoldings: async (owner: PublicKey) => {
        const l = holdings.get(owner.toBase58()) ?? 0n
        return { poolTokens: l, stakeLamports: l }
      },
      poolStats: async () => ({}) as any,
      solPrice: async () => ({ usd: 150, source: 'test' }),
    }
    const app = buildApp(deps)
    return { app, db, shaka, live, holdings, deps, setPeriod: (p: bigint) => (period = p) }
  }

  async function signIn(kp: Keypair) {
    const c = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
    const message = formatSiwsMessage({ ...c, address: kp.publicKey.toBase58() })
    const bytes = new TextEncoder().encode(message)
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: {
        address: kp.publicKey.toBase58(),
        signedMessage: Buffer.from(bytes).toString('base64'),
        signature: Buffer.from(nacl.sign.detached(bytes, kp.secretKey)).toString('base64'),
      },
    })
    return { authorization: `Bearer ${res.json().token}` }
  }

  beforeEach(() => {
    ctx = setup()
    ctx.holdings.set(liveKp.publicKey.toBase58(), MIN)
    ctx.holdings.set(mockKp.publicKey.toBase58(), MIN)
  })

  test('only allowlisted wallets get a real eSIM', async () => {
    const liveOrder = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: await signIn(liveKp) })).json()
    const mockOrder = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: await signIn(mockKp) })).json()
    assert.equal(liveOrder.providerMode, 'shaka_live')
    assert.equal(liveOrder.status, 'ready')
    assert.equal(mockOrder.providerMode, 'mock')
    assert.equal(ctx.shaka.subscriptions.length, 1)
  })

  test('reveals live installation details only to the owner', async () => {
    const auth = await signIn(liveKp)
    await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/esim/reveal', headers: auth })
    assert.equal(res.json().activationCode, 'LPA:1$smdp.example.test$K2-SECRET-CODE')
    assert.match(res.json().androidInstallUrl, /^https:\/\/esimsetup\.android\.com\//)
    // Another wallet's session reveals its own (mock) line, never this one.
    const other = await ctx.app.inject({ method: 'POST', url: '/v1/esim/reveal', headers: await signIn(mockKp) })
    assert.equal(other.statusCode, 404)
  })

  test("suspends a live line whose wallet didn't unlock the next period, and resumes on unlock", async () => {
    const auth = await signIn(liveKp)
    const first = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })).json()
    ctx.setPeriod(2n)
    const coverage = createCoverage({
      db: ctx.db,
      providerByMode: (m) => (m === 'shaka_live' ? ctx.live : ctx.deps.provider),
      fetchHoldings: ctx.deps.fetchHoldings,
    })
    const swept = await coverage.sweep(2n, MIN)
    assert.equal(swept.lapsed, 1)
    assert.equal(ctx.shaka.posts('journey/suspend-sim/').length, 1)
    ctx.shaka.completeJourneys()
    // Unlocking period 2 reuses the same line and lifts the suspension.
    const second = (await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: auth })).json()
    assert.notEqual(second.id, first.id)
    assert.equal(second.status, 'ready')
    assert.equal(second.suspended, false)
    assert.equal(ctx.shaka.subscriptions.length, 1)
    const line = ctx.live.lineByAddress(liveKp.publicKey.toBase58())!
    assert.equal(line.suspend_wanted, 0)
  })

  test('webhooks: verified, deduplicated, and only act on our own lines', async () => {
    await ctx.app.inject({ method: 'POST', url: '/v1/esim', headers: await signIn(liveKp) })
    const subId = ctx.shaka.subscriptions[0].id
    const send = (payload: object, sig?: string) => {
      const raw = JSON.stringify(payload)
      const t = Math.floor(Date.now() / 1000)
      return ctx.app.inject({
        method: 'POST',
        url: '/v1/webhooks/shaka',
        headers: {
          'content-type': 'application/json',
          'shaka-signature':
            sig ?? `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`,
        },
        payload: raw,
      })
    }
    assert.equal(
      (await send({ idempotency_id: 'e1', event_type: 'sim_status_changed', subscription_id: subId })).statusCode,
      200,
    )
    assert.equal(
      (await send({ idempotency_id: 'e1', event_type: 'sim_status_changed', subscription_id: subId })).statusCode,
      200,
    )
    assert.equal(
      (await send({ idempotency_id: 'e2', event_type: 'sim_status_changed', subscription_id: 424242 })).statusCode,
      200,
    )
    assert.equal((await send({ idempotency_id: 'e3' }, 't=1,v1=00')).statusCode, 401)
    const events = ctx.db.prepare('SELECT idempotency_id, ours FROM shaka_events ORDER BY idempotency_id').all()
    assert.deepEqual(
      events.map((e: any) => [e.idempotency_id, e.ours]),
      [
        ['e1', 1],
        ['e2', 0],
      ],
    )
  })
})
