import { Connection, PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { associatedTokenAddress, fetchStakePool, fetchValidatorList, poolTokensToLamports, validatorStakeAddress } from '@zero/shared'
import { connection, stakePoolAddress } from './chain'
import { cluster, env } from './env'

// Inflation is paid per slot of a nominal 400 ms, so annualise per slot rather than per
// wall-clock second: this gives a consistent figure on 64-slot localnet epochs too.
const SLOTS_PER_YEAR = (365.25 * 24 * 3600) / 0.4

export interface PoolStats {
  cluster: string
  epoch: number
  epochProgress: number
  totalStakedLamports: string
  zeroSolSupply: string
  exchangeRate: number
  reserveLamports: string
  /** Staking rewards the pool earned in the last completed epoch, all paid to Shaka. */
  lastEpochRewardsLamports: string
  /** Annual yield implied by the last epoch's rewards, or a reference rate if unavailable. */
  apy: number
  apySource: 'measured' | 'reference'
  treasuryEarnedLamports: string
  validators: { vote: string; activeLamports: string }[]
  updatedAt: string
}

let statsCache: { at: number; value: PoolStats } | undefined

export async function poolStats(): Promise<PoolStats> {
  if (statsCache && Date.now() - statsCache.at < 30_000) return statsCache.value
  const [pool, epochInfo] = await Promise.all([fetchStakePool(connection, stakePoolAddress), connection.getEpochInfo()])
  const list = await fetchValidatorList(connection, pool)
  const stakeAccounts = list.map((v) => validatorStakeAddress(pool.programId, v.voteAccount, pool.address, v.validatorSeedSuffix))

  let rewards = 0n
  let base = 0n
  if (epochInfo.epoch > 0 && stakeAccounts.length) {
    const results = await connection.getInflationReward(stakeAccounts, epochInfo.epoch - 1).catch(() => [])
    for (const r of results) {
      if (!r) continue
      rewards += BigInt(r.amount)
      base += BigInt(r.postBalance - r.amount)
    }
  }
  // Measured yield, annualised simply. Localnet's 64-slot epochs pay rewards that do not
  // annualise meaningfully, so implausible values fall back to a labelled reference.
  const epochsPerYear = SLOTS_PER_YEAR / epochInfo.slotsInEpoch
  const measured = base > 0n ? (Number(rewards) / Number(base)) * epochsPerYear : null
  const plausible = measured !== null && measured > 0 && measured < 0.25
  const apy = plausible ? measured : env.REFERENCE_APY
  const apySource: PoolStats['apySource'] = plausible ? 'measured' : 'reference'

  const treasuryAta = associatedTokenAddress(new PublicKey(cluster.treasury), pool.poolMint)
  const treasuryTokens = BigInt((await connection.getTokenAccountBalance(treasuryAta).catch(() => undefined))?.value.amount ?? '0')

  const value: PoolStats = {
    cluster: cluster.cluster,
    epoch: epochInfo.epoch,
    epochProgress: epochInfo.slotIndex / epochInfo.slotsInEpoch,
    totalStakedLamports: pool.totalLamports.toString(),
    zeroSolSupply: pool.poolTokenSupply.toString(),
    exchangeRate: pool.poolTokenSupply ? Number(pool.totalLamports) / Number(pool.poolTokenSupply) : 1,
    reserveLamports: String(await connection.getBalance(pool.reserveStake)),
    lastEpochRewardsLamports: rewards.toString(),
    apy,
    apySource,
    treasuryEarnedLamports: poolTokensToLamports(pool, treasuryTokens).toString(),
    validators: list.map((v) => ({ vote: v.voteAccount.toBase58(), activeLamports: v.activeStakeLamports.toString() })),
    updatedAt: new Date().toISOString(),
  }
  statsCache = { at: Date.now(), value }
  return value
}

// Pyth's sponsored SOL/USD price account on mainnet (pull oracle, PriceUpdateV2), read
// straight from chain. Test clusters have no real price, so mainnet is the reference.
const PYTH_SOL_USD_ACCOUNT = new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE')
const PYTH_SOL_USD_FEED = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
const mainnet = new Connection(env.MAINNET_RPC_URL, 'confirmed')
let priceCache: { at: number; value: { usd: number; source: string } } | undefined

export async function solPrice(): Promise<{ usd: number; source: string }> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.value
  try {
    const info = await mainnet.getAccountInfo(PYTH_SOL_USD_ACCOUNT)
    if (!info) throw new Error('missing price account')
    const d = Buffer.from(info.data)
    // discriminator(8) write_authority(32) verification_level(enum: Partial{u8}=0 | Full=1)
    const o = d[40] === 1 ? 41 : 42
    if (d.subarray(o, o + 32).toString('hex') !== PYTH_SOL_USD_FEED) throw new Error('unexpected feed')
    const price = Number(d.readBigInt64LE(o + 32)) * 10 ** d.readInt32LE(o + 48)
    const publishTime = Number(d.readBigInt64LE(o + 52))
    if (!(price > 0) || Date.now() / 1000 - publishTime > 3600) throw new Error('stale price')
    priceCache = { at: Date.now(), value: { usd: price, source: 'pyth' } }
  } catch {
    priceCache = { at: Date.now(), value: { usd: env.SOL_USD_FALLBACK, source: 'fallback' } }
  }
  return priceCache.value
}
