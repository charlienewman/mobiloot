import { PublicKey } from '@solana/web3.js'
import { associatedTokenAddress, fetchStakePool, fetchValidatorList, poolTokensToLamports } from '@mobiloot/shared'
import { connection, loadConfig, sol } from './lib'

const config = loadConfig()
const pool = await fetchStakePool(connection, new PublicKey(config.stakePool))
const list = await fetchValidatorList(connection, pool)
const { epoch } = await connection.getEpochInfo()
const treasuryAta = associatedTokenAddress(new PublicKey(config.treasury), pool.poolMint)
const treasuryTokens = BigInt((await connection.getTokenAccountBalance(treasuryAta)).value.amount)
const reserve = await connection.getBalance(pool.reserveStake)

console.log(
  `lootSOL pool ${pool.address.toBase58()} (${config.cluster}, epoch ${epoch}, updated ${pool.lastUpdateEpoch})`,
)
console.log(`  total staked      ${sol(pool.totalLamports)} SOL`)
console.log(
  `  lootSOL supply    ${sol(pool.poolTokenSupply)}  (1 lootSOL = ${(Number(pool.totalLamports) / Number(pool.poolTokenSupply)).toFixed(9)} SOL)`,
)
console.log(`  epoch fee         ${pool.epochFee.numerator}/${pool.epochFee.denominator} → Mobiloot treasury`)
console.log(`  reserve (liquid)  ${sol(reserve)} SOL`)
console.log(
  `  treasury earned   ${sol(treasuryTokens)} lootSOL ≈ ${sol(poolTokensToLamports(pool, treasuryTokens))} SOL`,
)
for (const v of list) {
  console.log(
    `  validator ${v.voteAccount.toBase58()}  active ${sol(v.activeStakeLamports)}  transient ${sol(v.transientStakeLamports)}`,
  )
}
