// Keeps the pool updated each epoch. Anyone can do this; the API does it so deposits
// never hit a stale pool and rewards reach the Mobiloot treasury promptly.
import { Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { fetchStakePool, fetchValidatorList, updateIxs } from '@mobiloot/shared'
import { connection, stakePoolAddress } from './chain'
import { crankSecretKey } from './env'

export function startCrank(log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  const secret = crankSecretKey()
  if (!secret) {
    log.info({}, 'pool crank disabled (no CRANK_KEYPAIR or CRANK_KEYPAIR_JSON)')
    return () => {}
  }
  const payer = Keypair.fromSecretKey(secret)
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const { epoch } = await connection.getEpochInfo()
      const pool = await fetchStakePool(connection, stakePoolAddress)
      if (pool.lastUpdateEpoch < BigInt(epoch)) {
        const list = await fetchValidatorList(connection, pool)
        for (const ix of updateIxs(pool, list)) {
          await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { commitment: 'confirmed' })
        }
        log.info({ epoch }, 'pool updated for new epoch')
      }
    } catch (e: any) {
      log.warn({ err: e.message }, 'pool crank failed')
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, 15_000)
  void tick()
  return () => clearInterval(timer)
}
