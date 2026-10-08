import { buildApp } from './app'
import { currentPeriod, fetchEntitlement, fetchHoldings, fetchMobilootConfig } from './chain'
import { createCoverage } from './coverage'
import { startCrank } from './crank'
import { openDb } from './db'
import { cluster, env } from './env'
import { createProviders } from './provider'
import { poolStats, solPrice } from './stats'

const db = openDb(env.DB_PATH)
const providers = createProviders(db)
const providerByMode = (mode: string) =>
  providers.live?.mode === mode ? providers.live : providers.mock.mode === mode ? providers.mock : undefined
const app = buildApp({
  db,
  provider: providers.mock,
  live: providers.live,
  liveWallets: providers.liveWallets,
  shakaWebhookSecret: env.SHAKA_WEBHOOK_SECRET,
  cluster,
  signInDomain: env.SIGN_IN_DOMAIN,
  trustProxy: env.TRUST_PROXY,
  fetchMobilootConfig,
  currentPeriod,
  fetchEntitlement,
  fetchHoldings,
  poolStats,
  solPrice,
})

const stopCrank = startCrank(app.log)

// Re-check every active line's coverage each minute (see coverage.ts).
const coverage = createCoverage({ db, providerByMode, fetchHoldings })
const sweep = setInterval(async () => {
  try {
    const config = await fetchMobilootConfig()
    const result = await coverage.sweep(await currentPeriod(config), config.minStakeLamports)
    if (result.changed) app.log.info(result, 'coverage sweep changed line states')
  } catch (e: any) {
    app.log.warn({ err: e.message }, 'coverage sweep failed')
  }
}, 60_000)
// Live lines: advance provisioning and suspensions, then copy results onto pending
// orders. Webhooks only make this run sooner; it works without them.
let reconciling = false
const reconcile = setInterval(async () => {
  if (!providers.live || reconciling) return
  reconciling = true
  try {
    await providers.live.reconcileDue()
    const pending = db
      .prepare("SELECT * FROM orders WHERE provider_mode = 'shaka_live' AND status = 'pending'")
      .all() as any[]
    for (const row of pending) await app.refreshOrder(row)
  } catch (e: any) {
    app.log.warn({ err: e.message }, 'live line reconcile failed')
  } finally {
    reconciling = false
  }
}, 15_000)
app.addHook('onClose', async () => {
  stopCrank()
  clearInterval(sweep)
  clearInterval(reconcile)
  db.close()
})

// Hosts stop the container with SIGTERM on every redeploy; exit cleanly so it isn't
// reported as a crash.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    process.exit(0)
  })
}

await app.listen({ port: env.PORT, host: env.HOST })
app.log.info(
  { cluster: cluster.cluster, liveEsim: Boolean(providers.live), liveWallets: providers.liveWallets.size },
  'Mobiloot API ready',
)
