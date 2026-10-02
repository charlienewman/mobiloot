import { buildApp } from './app'
import { currentPeriod, fetchEntitlement, fetchHoldings, fetchMobilootConfig } from './chain'
import { createCoverage } from './coverage'
import { startCrank } from './crank'
import { openDb } from './db'
import { cluster, env } from './env'
import { createProvider } from './provider'
import { poolStats, solPrice } from './stats'

const db = openDb(env.DB_PATH)
const provider = createProvider()
const app = buildApp({
  db,
  provider,
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
const coverage = createCoverage({ db, provider, fetchHoldings })
const sweep = setInterval(async () => {
  try {
    const config = await fetchMobilootConfig()
    const result = await coverage.sweep(await currentPeriod(config), config.minStakeLamports)
    if (result.changed) app.log.info(result, 'coverage sweep changed line states')
  } catch (e: any) {
    app.log.warn({ err: e.message }, 'coverage sweep failed')
  }
}, 60_000)
app.addHook('onClose', async () => {
  stopCrank()
  clearInterval(sweep)
})

await app.listen({ port: env.PORT, host: env.HOST })
app.log.info({ cluster: cluster.cluster, provider: env.PROVIDER_MODE }, 'Mobiloot API ready')
