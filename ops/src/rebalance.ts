// Delegates SOL that has built up in the pool reserve (from user deposits) to the
// pool's validators, keeping a buffer liquid for instant withdrawals. Staker only.
//   CLUSTER=devnet npm -w ops run rebalance
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { fetchStakePool, fetchValidatorList, increaseValidatorStakeIx, refreshIxs } from '@mobiloot/shared'
import { CLUSTER, connection, loadConfig, namedKeypair, send, sol } from './lib'

const config = loadConfig()
const staker = namedKeypair('treasury')
let pool = await fetchStakePool(connection, new PublicKey(config.stakePool))
const refresh = await refreshIxs(connection, pool)
for (const ix of refresh) await send('update pool', [ix])
pool = await fetchStakePool(connection, pool.address)

const list = await fetchValidatorList(connection, pool)
const reserve = BigInt(await connection.getBalance(pool.reserveStake))
const buffer = BigInt(
  Math.round(Number(process.env.RESERVE_BUFFER_SOL ?? (CLUSTER === 'localnet' ? 2 : 0.25)) * LAMPORTS_PER_SOL),
)
const minDelegation = BigInt((await connection.getStakeMinimumDelegation()).value)
const available = reserve - buffer
console.log(`reserve ${sol(reserve)} SOL, buffer ${sol(buffer)}, minimum delegation ${sol(minDelegation)}`)
if (available < minDelegation || list.length === 0) {
  console.log('nothing to delegate')
} else {
  // Everything to the validator with the least stake, to spread it over time.
  const target = [...list].sort((a, b) => Number(a.activeStakeLamports - b.activeStakeLamports))[0]
  if (target.transientStakeLamports > 0n) {
    console.log('validator has a transient stake this epoch; try next epoch')
  } else {
    await send(
      `delegate ${sol(available)} SOL to ${target.voteAccount.toBase58()}`,
      [increaseValidatorStakeIx(pool, target, available, target.transientSeedSuffix + 1n)],
      [staker],
    )
  }
}
