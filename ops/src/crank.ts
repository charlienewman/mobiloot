// Permissionless epoch update. Deposits and withdrawals fail until the pool has been
// updated for the current epoch, and this is also the moment the epoch's rewards are
// minted to the Mobiloot treasury as lootSOL. Run once per epoch (the API does this
// automatically); pass --watch to keep running.
import { PublicKey } from '@solana/web3.js'
import { fetchStakePool, fetchValidatorList, updateIxs } from '@mobiloot/shared'
import { connection, loadConfig, send, sol } from './lib'

export async function crankOnce(poolAddress: PublicKey) {
  const { epoch } = await connection.getEpochInfo()
  const pool = await fetchStakePool(connection, poolAddress)
  if (pool.lastUpdateEpoch >= BigInt(epoch)) return false
  const before = pool.totalLamports
  const list = await fetchValidatorList(connection, pool)
  for (const ix of updateIxs(pool, list)) await send(`update epoch ${epoch}`, [ix])
  const after = await fetchStakePool(connection, poolAddress)
  console.log(`epoch ${epoch}: pool ${sol(before)} → ${sol(after.totalLamports)} SOL, rewards to treasury`)
  return true
}

const config = loadConfig()
const pool = new PublicKey(config.stakePool)
if (process.argv.includes('--watch')) {
  for (;;) {
    await crankOnce(pool).catch((e) => console.error(e.message))
    await new Promise((r) => setTimeout(r, 10_000))
  }
} else {
  if (!(await crankOnce(pool))) console.log('pool already up to date')
}
