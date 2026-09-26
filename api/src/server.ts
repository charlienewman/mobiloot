import { buildApp } from './app'
import { currentPeriod, fetchEntitlement, fetchHoldings, fetchZeroConfig } from './chain'
import { startCrank } from './crank'
import { openDb } from './db'
import { cluster, env } from './env'
import { createProvider } from './provider'
import { poolStats, solPrice } from './stats'

const app = buildApp({
  db: openDb(env.DB_PATH),
  provider: createProvider(),
  cluster,
  signInDomain: env.SIGN_IN_DOMAIN,
  fetchZeroConfig,
  currentPeriod,
  fetchEntitlement,
  fetchHoldings,
  poolStats,
  solPrice,
})

const stopCrank = startCrank(app.log)
app.addHook('onClose', async () => stopCrank())

await app.listen({ port: env.PORT, host: env.HOST })
app.log.info({ cluster: cluster.cluster, provider: env.PROVIDER_MODE }, 'Zero Mobile API ready')
