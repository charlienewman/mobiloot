// Live eSIMs from Shaka's Nexus API (v1.3). Mobiloot keeps one line per wallet across
// periods: each period's order points at the same Shaka subscription, and coverage
// suspends or unsuspends it rather than ordering a new eSIM every month.
//
// Provisioning is a small state machine persisted in `shaka_lines`. Every request's
// identity (idempotency keys, references) is saved before the request is sent, and every
// accepted ID is saved as soon as it comes back, so a timeout, crash or redeploy resumes
// the same operation instead of allocating a second eSIM. `advance()` moves a line one
// step towards canonical provider state; the reconciler, webhooks and app requests all
// go through it.
import crypto from 'node:crypto'
import type { Db } from '../db'
import type { Activation, CreateOrderInput, MobileProvider, ProviderOrder, Usage } from './types'

export interface ShakaConfig {
  baseUrl: string
  apiKey: string
  planId: number
  /** App and environment namespace for every reference, e.g. `mobiloot-devnet`. */
  referencePrefix: string
  /** Public HTTPS receiver for this app's journeys. Polling works without it. */
  webhookUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

export interface ShakaLineRow {
  id: string
  address: string
  plan_id: number
  base_url: string
  subscriber_ref: string
  subscriber_key: string
  subscriber_id: number | null
  subscription_ref: string
  subscription_key: string
  journey_id: string | null
  journey_status: string | null
  subscription_id: number | null
  sub_status: string | null
  sim_status: string | null
  iccid: string | null
  state: 'provisioning' | 'ready' | 'failed' | 'needs_review'
  suspend_wanted: number
  suspension_kind: 'suspend-sim' | 'unsuspend-sim' | null
  suspension_seq: number
  suspension_key: string | null
  suspension_journey_id: string | null
  attempts: number
  next_check_at: number
  last_error: string | null
  last_request_id: string | null
  synced_at: number | null
  created_at: number
  updated_at: number
}

export class ShakaHttpError extends Error {
  retryAfterMs?: number
  constructor(
    readonly status: number,
    readonly requestId: string,
    readonly body: any,
    message: string,
  ) {
    super(message)
  }
}

/** Stops the state machine for this line until someone looks at it. */
class Review extends Error {}

const FAILED_JOURNEY = new Set(['failed', 'invalid', 'cancelled'])
const MAX_PAGES = 50

export class ShakaLiveProvider implements MobileProvider {
  readonly mode = 'shaka_live' as const
  private readonly base: URL
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly db: Db,
    private readonly cfg: ShakaConfig,
  ) {
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.planId)
      throw new Error('SHAKA_BASE_URL, SHAKA_API_KEY and SHAKA_PLAN_ID are required')
    this.base = new URL(cfg.baseUrl.replace(/\/+$/, '') + '/')
    if (this.base.protocol !== 'https:') throw new Error('SHAKA_BASE_URL must be https')
    if (cfg.webhookUrl && !cfg.webhookUrl.startsWith('https://')) throw new Error('SHAKA_WEBHOOK_URL must be https')
    this.fetch = cfg.fetch ?? fetch
    this.now = cfg.now ?? Date.now
  }

  // ── MobileProvider ────────────────────────────────────────────────────────────────

  async createOrder({ owner }: CreateOrderInput): Promise<ProviderOrder> {
    const now = this.now()
    const id = crypto.randomUUID()
    // One line per wallet: a later period reuses it. Keys and references are fixed here,
    // before anything is sent, and never change for this line.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO shaka_lines (id, address, plan_id, base_url, subscriber_ref, subscriber_key,
           subscription_ref, subscription_key, state, next_check_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', ?, ?, ?)`,
      )
      .run(
        id,
        owner,
        this.cfg.planId,
        this.base.href,
        `${this.cfg.referencePrefix}-wallet-${owner}`,
        crypto.randomUUID(),
        `${this.cfg.referencePrefix}-line-${id}`,
        crypto.randomUUID(),
        now,
        now,
        now,
      )
    const line = this.lineByAddress(owner)!
    return this.toOrder(await this.advance(line.id))
  }

  async getOrder(providerOrderId: string): Promise<ProviderOrder> {
    const line = this.line(providerOrderId)
    if (!line) throw new Error('unknown line')
    return this.toOrder(line.next_check_at <= this.now() ? await this.advance(line.id) : line)
  }

  async getActivation(providerOrderId: string): Promise<Activation> {
    const line = this.line(providerOrderId)
    if (!line?.subscription_id || line.state !== 'ready') throw new Error('line not ready')
    // Read on demand so installation secrets are never stored by Mobiloot.
    const sub = await this.request('GET', `data/subscriptions/${line.subscription_id}/`)
    this.checkOwnership(line, sub)
    const esim = sub.current_sim?.esim_data
    if (!esim?.activation_code) throw new Error('no installation data')
    return activationFrom(esim, sub.current_msisdn)
  }

  async getUsage(providerOrderId: string, dataTotalMb: number | null): Promise<Usage> {
    const line = this.line(providerOrderId)
    if (!line?.subscription_id) throw new Error('line not ready')
    const u = await this.request('GET', `data/subscriptions/${line.subscription_id}/usage/`)
    const local = u.local ?? {}
    const remainingMb = local.data?.remaining == null ? null : bytesToMb(local.data.remaining)
    const usedMb = bytesToMb(local.data?.used ?? 0)
    return {
      dataUsedMb: usedMb,
      // Unlimited plans report remaining as null (fair use applies but isn't published).
      dataTotalMb: remainingMb == null ? dataTotalMb : usedMb + remainingMb,
      minutesUsed: Math.round((local.voice?.used ?? 0) / 60),
      textsUsed: local.sms?.used ?? 0,
      updatedAt: new Date(this.now()).toISOString(),
    }
  }

  async suspend(providerOrderId: string) {
    await this.wantSuspended(providerOrderId, true)
  }

  async resume(providerOrderId: string) {
    await this.wantSuspended(providerOrderId, false)
  }

  // ── Reconciliation entry points ───────────────────────────────────────────────────

  /** Advances every line that is due a check. Run on a timer. */
  async reconcileDue(limit = 20) {
    const due = this.db
      .prepare(
        `SELECT id FROM shaka_lines WHERE state IN ('provisioning', 'ready') AND next_check_at <= ?
         ORDER BY next_check_at LIMIT ?`,
      )
      .all(this.now(), limit) as { id: string }[]
    for (const { id } of due) await this.advance(id)
    return due.length
  }

  /**
   * A verified webhook is only a hint: find the line it concerns, if it is ours, and
   * check it now against canonical state. Returns whether the event was ours.
   */
  noteEvent(event: {
    subscription_id?: number | null
    journey_id?: string | null
    subscription_reference_id?: string | null
  }) {
    const line = this.db
      .prepare(
        `SELECT id FROM shaka_lines
         WHERE (subscription_id IS NOT NULL AND subscription_id = ?)
            OR (journey_id IS NOT NULL AND journey_id = ?)
            OR (suspension_journey_id IS NOT NULL AND suspension_journey_id = ?)
            OR subscription_ref = ?`,
      )
      .get(
        event.subscription_id ?? -1,
        event.journey_id ?? '',
        event.journey_id ?? '',
        event.subscription_reference_id ?? '',
      ) as { id: string } | undefined
    if (!line) return false
    this.db.prepare('UPDATE shaka_lines SET next_check_at = ? WHERE id = ?').run(this.now(), line.id)
    return true
  }

  line(id: string) {
    return this.db.prepare('SELECT * FROM shaka_lines WHERE id = ?').get(id) as ShakaLineRow | undefined
  }

  lineByAddress(address: string) {
    return this.db.prepare('SELECT * FROM shaka_lines WHERE address = ?').get(address) as ShakaLineRow | undefined
  }

  // ── State machine ─────────────────────────────────────────────────────────────────

  /** One serialized step per line; concurrent callers share the same run. */
  advance(id: string): Promise<ShakaLineRow> {
    const running = this.locks.get(id) as Promise<ShakaLineRow> | undefined
    if (running) return running
    const run = this.step(id).finally(() => this.locks.delete(id))
    this.locks.set(id, run)
    return run
  }

  private async step(id: string): Promise<ShakaLineRow> {
    let line = this.line(id)!
    if (line.state === 'failed' || line.state === 'needs_review') return line
    if (line.base_url !== this.base.href) {
      // IDs are scoped to one provider account; never mix them.
      return this.update(id, { state: 'needs_review', last_error: 'Line belongs to a different Shaka host' })
    }
    try {
      if (!line.subscriber_id) line = await this.ensureSubscriber(line)
      if (!line.subscription_id) line = await this.ensureSubscription(line)
      // The subscription can exist (inactive) while its creation journey is still running.
      if (
        line.subscription_id &&
        line.state === 'provisioning' &&
        line.journey_id &&
        line.journey_status !== 'completed'
      )
        line = await this.checkJourney(line)
      if (line.subscription_id && line.state !== 'failed') line = await this.syncCanonical(line)
      if (line.state === 'ready') line = await this.driveSuspension(line)
      if (line.state === 'failed') return line
      // Creation is usually quick, so poll fast at first; suspensions took 3–5 minutes
      // in testing; settled lines get a periodic canonical check.
      const young = this.now() - line.created_at < 60_000
      const delay =
        line.state === 'provisioning'
          ? young
            ? 3_000
            : 15_000
          : line.suspension_journey_id || this.suspensionPending(line)
            ? 20_000
            : 5 * 60_000
      return this.update(id, { attempts: 0, last_error: null, next_check_at: this.now() + delay })
    } catch (e: any) {
      return this.failStep(id, e)
    }
  }

  private failStep(id: string, e: any): ShakaLineRow {
    const line = this.line(id)!
    const requestId = e instanceof ShakaHttpError ? e.requestId : null
    // A working line stays usable through API errors (e.g. a refused suspension); only
    // provisioning problems or a line that is no longer ours stop it.
    const settled = line.state === 'ready' && !(e instanceof Review)
    if (e instanceof Review)
      return this.update(id, { state: 'needs_review', last_error: e.message, last_request_id: requestId })
    if (!settled && e instanceof ShakaHttpError && (e.status === 401 || e.status === 403)) {
      // Configuration problem: stop mutating until someone fixes the key.
      return this.update(id, {
        state: 'needs_review',
        last_error: `Shaka rejected the API key (${e.status})`,
        last_request_id: requestId,
      })
    }
    if (!settled && e instanceof ShakaHttpError && (e.status === 400 || e.status === 422)) {
      return this.update(id, {
        state: 'needs_review',
        last_error: `Shaka rejected the request (${e.status})`,
        last_request_id: requestId,
      })
    }
    // Timeouts, 429, 5xx and unknown responses: the outcome may be uncertain, so retry
    // later with the same identity and let reconciliation find what happened.
    const attempts = line.attempts + 1
    const retryAfter = e instanceof ShakaHttpError ? e.retryAfterMs : undefined
    const backoff = Math.min(10 * 60_000, 2_000 * 2 ** Math.min(attempts, 9)) * (0.75 + Math.random() * 0.5)
    return this.update(id, {
      attempts,
      last_error:
        e instanceof ShakaHttpError ? `Shaka ${e.status || 'network error'}` : String(e.message ?? e).slice(0, 200),
      last_request_id: requestId,
      next_check_at: this.now() + Math.max(retryAfter ?? 0, backoff),
    })
  }

  private async ensureSubscriber(line: ShakaLineRow) {
    // Recovery first: an earlier attempt may have created it before we saved the ID.
    const matches = (await this.listAll('data/subscribers/', { reference_id: line.subscriber_ref })).filter(
      (s) => s.reference_id === line.subscriber_ref,
    )
    if (matches.length > 1) throw new Review('More than one Shaka subscriber has this wallet reference')
    let id: number | undefined = matches[0]?.id
    if (!id) {
      const short = `${line.address.slice(0, 4)}…${line.address.slice(-4)}`
      try {
        const created = await this.request('POST', 'data/subscribers/', {
          idempotencyKey: line.subscriber_key,
          body: {
            name: `Mobiloot wallet ${short}`,
            // Wallets have no email; this is a non-delivering address on Mobiloot's domain.
            email: `wallet-${line.address.toLowerCase()}@users.mobiloot.com`,
            reference_id: line.subscriber_ref,
          },
        })
        id = created.id
      } catch (e) {
        id = replayedId(e, 'id')
        if (!id) throw e
      }
    }
    if (!Number.isInteger(id)) throw new Review('Shaka returned no subscriber id')
    return this.update(line.id, { subscriber_id: id! })
  }

  private async ensureSubscription(line: ShakaLineRow) {
    let found = await this.findSubscription(line)
    if (!found && !line.journey_id) {
      const body: Record<string, unknown> = {
        subscriber_id: line.subscriber_id,
        plan_id: line.plan_id,
        service_type: 'local',
        adult_services_enabled: false,
        preactivate_physical_sim: false,
        reference_id: line.subscription_ref,
      }
      if (this.cfg.webhookUrl) body.webhook_url = this.cfg.webhookUrl
      let journeyId: string | undefined
      try {
        journeyId = (
          await this.request('POST', 'journey/new-subscription/', { idempotencyKey: line.subscription_key, body })
        ).journey_id
      } catch (e) {
        journeyId = replayedId(e, 'journey_id')
        if (!journeyId) throw e
      }
      if (typeof journeyId !== 'string' || !journeyId) throw new Review('Shaka accepted the order without a journey id')
      // Saved before anything else so a crash can't lose the accepted order.
      line = this.update(line.id, { journey_id: journeyId, journey_status: 'started' })
    }
    if (!found && line.journey_id) {
      line = await this.checkJourney(line)
      if (line.state === 'failed') return line
      found = await this.findSubscription(line)
    }
    return found ? this.update(line.id, { subscription_id: found.id }) : line
  }

  private async checkJourney(line: ShakaLineRow) {
    const journey = await this.request('GET', `journey/new-subscription/${line.journey_id}/`)
    line = this.update(line.id, { journey_status: String(journey.status) })
    if (!FAILED_JOURNEY.has(journey.status)) return line
    return this.update(line.id, {
      state: 'failed',
      last_error: `eSIM order ${journey.status}${journey.failure_reason ? `: ${String(journey.failure_reason).slice(0, 160)}` : ''}`,
    })
  }

  /** The line's subscription by exact reference, else by the journey that created it. */
  private async findSubscription(line: ShakaLineRow) {
    const mine = (s: any) => s.subscriber === line.subscriber_id
    const byRef = (
      await this.listAll('data/subscriptions/', {
        subscriber_id: String(line.subscriber_id),
        reference_id: line.subscription_ref,
      })
    ).filter((s) => mine(s) && s.reference_id === line.subscription_ref)
    if (byRef.length > 1) throw new Review('More than one Shaka subscription has this line reference')
    if (byRef.length === 1) return byRef[0]
    if (!line.journey_id) return undefined
    const byJourney = (await this.listAll('data/subscriptions/', { subscriber_id: String(line.subscriber_id) })).filter(
      (s) => mine(s) && s.journeys?.created_by === line.journey_id,
    )
    if (byJourney.length > 1) throw new Review('More than one Shaka subscription claims this journey')
    return byJourney[0]
  }

  private checkOwnership(line: ShakaLineRow, sub: any) {
    const ours =
      sub.id === line.subscription_id &&
      sub.subscriber === line.subscriber_id &&
      (sub.reference_id === line.subscription_ref || (line.journey_id && sub.journeys?.created_by === line.journey_id))
    if (!ours) throw new Review('Shaka subscription does not match this line')
  }

  private async syncCanonical(line: ShakaLineRow) {
    const sub = await this.request('GET', `data/subscriptions/${line.subscription_id}/`)
    this.checkOwnership(line, sub)
    const sim = sub.current_sim
    if (sim && sim.sim_type !== 'esim') throw new Review(`Shaka assigned a ${sim.sim_type} SIM, not an eSIM`)
    const patch: Partial<ShakaLineRow> = {
      sub_status: sub.status ?? null,
      sim_status: sim?.status ?? null,
      iccid: sim?.serial_number ? String(sim.serial_number) : null,
      synced_at: this.now(),
    }
    if (sub.status === 'cancelled' || sim?.status === 'terminated') {
      return this.update(line.id, { ...patch, state: 'failed', last_error: 'The line has ended' })
    }
    // Ready only on canonical evidence: an active subscription, a live eSIM (ours may be
    // suspended for coverage) and installation material to hand over.
    const ready =
      sub.status === 'active' &&
      (sim?.status === 'active' || sim?.status === 'suspended') &&
      Boolean(sim?.esim_data?.activation_code)
    // Remember an in-flight suspension journey we didn't start (or lost) so we don't stack another.
    const inFlight = sub.journeys?.suspension ?? null
    if (inFlight && !line.suspension_journey_id) patch.suspension_journey_id = inFlight
    return this.update(line.id, {
      ...patch,
      state: ready ? 'ready' : line.state === 'ready' ? 'ready' : 'provisioning',
    })
  }

  private suspensionPending(line: ShakaLineRow) {
    return (
      (line.suspend_wanted === 1 && line.sim_status === 'active') ||
      (line.suspend_wanted === 0 && line.sim_status === 'suspended')
    )
  }

  private async driveSuspension(line: ShakaLineRow) {
    if (line.suspension_journey_id) {
      const kind = line.suspension_kind ?? (line.sim_status === 'suspended' ? 'unsuspend-sim' : 'suspend-sim')
      const journey = await this.request('GET', `journey/${kind}/${line.suspension_journey_id}/`)
      if (journey.status === 'requested') return line
      // Completed or failed: either way, re-read the SIM before deciding anything else.
      line = this.update(line.id, { suspension_journey_id: null, suspension_key: null })
      line = await this.syncCanonical(line)
      // Back off rather than resubmitting straight away.
      if (journey.status === 'failed') throw new Error(`Line ${kind} journey failed`)
      return line
    }
    if (!this.suspensionPending(line)) return line
    const kind = line.suspend_wanted ? 'suspend-sim' : 'unsuspend-sim'
    if (!line.suspension_key || line.suspension_kind !== kind) {
      line = this.update(line.id, {
        suspension_kind: kind,
        suspension_seq: line.suspension_seq + 1,
        suspension_key: crypto.randomUUID(),
      })
    }
    const body: Record<string, unknown> = {
      subscription_id: line.subscription_id,
      reference_id: `${this.cfg.referencePrefix}-${kind}-${line.id}-${line.suspension_seq}`,
    }
    if (this.cfg.webhookUrl) body.webhook_url = this.cfg.webhookUrl
    let journeyId: string | undefined
    try {
      journeyId = (await this.request('POST', `journey/${kind}/`, { idempotencyKey: line.suspension_key!, body }))
        .journey_id
    } catch (e) {
      journeyId = replayedId(e, 'journey_id')
      if (!journeyId && e instanceof ShakaHttpError && e.status === 409) {
        // The SIM isn't in the state the journey needs (or suspension isn't enabled);
        // re-read it after a backoff.
        this.update(line.id, { suspension_key: null })
        throw e
      }
      if (!journeyId) throw e
    }
    return this.update(line.id, { suspension_journey_id: journeyId ?? null })
  }

  private async wantSuspended(id: string, wanted: boolean) {
    const line = this.line(id)
    if (!line) throw new Error('unknown line')
    if (Boolean(line.suspend_wanted) === wanted) return
    this.update(id, { suspend_wanted: wanted ? 1 : 0, next_check_at: this.now() })
    await this.advance(id)
  }

  private toOrder(line: ShakaLineRow): ProviderOrder {
    return {
      providerOrderId: line.id,
      status: line.state === 'ready' ? 'ready' : line.state === 'provisioning' ? 'pending' : 'failed',
      iccid: line.iccid ?? undefined,
      hasActivation: line.state === 'ready',
      suspended: line.suspend_wanted === 1,
      error:
        line.state === 'failed'
          ? (line.last_error ?? 'The eSIM order failed')
          : line.state === 'needs_review'
            ? 'Your eSIM needs a manual check by Mobiloot support'
            : undefined,
    }
  }

  private update(id: string, patch: Partial<ShakaLineRow>): ShakaLineRow {
    const entries = Object.entries({ ...patch, updated_at: this.now() })
    this.db
      .prepare(`UPDATE shaka_lines SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...(entries.map(([, v]) => v ?? null) as any[]), id)
    return this.line(id)!
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────────────

  private async listAll(path: string, query: Record<string, string>) {
    const results: any[] = []
    let url: URL | null = this.url(path, query)
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body = await this.requestUrl('GET', url)
      if (!Array.isArray(body?.results)) throw new ShakaHttpError(0, '', null, 'Unexpected list response')
      results.push(...body.results)
      // Only follow pagination on the configured host, so the key never goes elsewhere.
      const next: URL | null = body.next ? new URL(body.next, this.base) : null
      url = next && next.origin === this.base.origin ? next : null
    }
    if (url) throw new ShakaHttpError(0, '', null, 'Too many pages')
    return results
  }

  private url(path: string, query?: Record<string, string>) {
    const url = new URL(path, this.base)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    return url
  }

  private request(method: 'GET' | 'POST', path: string, opts: { body?: unknown; idempotencyKey?: string } = {}) {
    return this.requestUrl(method, this.url(path), opts)
  }

  private async requestUrl(method: 'GET' | 'POST', url: URL, opts: { body?: unknown; idempotencyKey?: string } = {}) {
    const requestId = crypto.randomUUID()
    const headers: Record<string, string> = {
      Authorization: `Api-Key ${this.cfg.apiKey}`,
      Accept: 'application/json',
      'X-Request-ID': requestId,
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
    let res: Response
    try {
      res = await this.fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      })
    } catch {
      throw new ShakaHttpError(0, requestId, null, `Shaka ${method} failed to connect`)
    }
    const text = await res.text()
    let body: any = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      if (res.ok) throw new ShakaHttpError(res.status, requestId, null, 'Malformed Shaka response')
    }
    if (!res.ok) {
      const err = new ShakaHttpError(
        res.status,
        res.headers.get('x-request-id') ?? requestId,
        body,
        `Shaka ${method} ${res.status}`,
      )
      const retryAfter = Number(res.headers.get('retry-after'))
      if (retryAfter > 0) err.retryAfterMs = retryAfter * 1000
      throw err
    }
    return body
  }
}

/** A same-key replay answered 409 with the original resource's identifier. */
function replayedId(e: unknown, field: 'id' | 'journey_id'): any {
  if (!(e instanceof ShakaHttpError) || e.status !== 409 || !e.body || typeof e.body !== 'object') return undefined
  return e.body[field] ?? e.body.id ?? e.body.journey_id
}

const bytesToMb = (b: number) => Math.round(b / 1_048_576)

/** Builds what the app needs to install the eSIM from the provider's `esim_data`. */
export function activationFrom(esim: any, msisdn?: string | null): Activation {
  const raw = String(esim.activation_code)
  const smdp = esim.sm_dp_address ? String(esim.sm_dp_address) : null
  const lpa = raw.startsWith('LPA:') ? raw : `LPA:1$${smdp ?? ''}$${raw}`
  const [, smdpAddress, matchingId] = lpa.split('$')
  const android = typeof esim.android_activation_data === 'string' ? esim.android_activation_data : ''
  return {
    activationCode: lpa,
    smdpAddress: smdpAddress || smdp,
    matchingId: matchingId || null,
    // Google's eSIM install link; prefer the provider's own if it is exactly that.
    androidInstallUrl: android.startsWith('https://esimsetup.android.com/')
      ? android
      : `https://esimsetup.android.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}`,
    msisdn: msisdn ? String(msisdn) : null,
  }
}

/**
 * Checks a `Shaka-Signature: t=<unix>,v1=<hex>` header: HMAC-SHA256 over
 * `<t>.<raw body>`. Retries keep the original timestamp, so the window is generous.
 */
export function verifyShakaSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string,
  nowMs = Date.now(),
  { maxAgeMs = 3 * 86_400_000, maxSkewMs = 5 * 60_000 } = {},
) {
  if (!header || !secret) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '')
  if (!Number.isFinite(t) || !sigs.length) return false
  const age = nowMs - t * 1000
  if (age > maxAgeMs || age < -maxSkewMs) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest()
  return sigs.some((s) => {
    const given = Buffer.from(s, 'hex')
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
  })
}
