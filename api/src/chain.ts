import { Connection, PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import {
  associatedTokenAddress,
  configAddress,
  decodeConfig,
  decodeEntitlement,
  entitlementAddress,
  fetchStakePool,
  periodAt,
  poolTokensToLamports,
  type Entitlement,
  type ZeroConfig,
} from '@zero/shared'
import { cluster, rpcUrl } from './env'

export const connection = new Connection(rpcUrl, 'confirmed')
export const programId = new PublicKey(cluster.zeroProgram!)
export const stakePoolAddress = new PublicKey(cluster.stakePool)

export async function fetchZeroConfig(): Promise<ZeroConfig> {
  const info = await connection.getAccountInfo(configAddress(programId))
  if (!info) throw new Error('zero_mobile config not initialized')
  return decodeConfig(Buffer.from(info.data))
}

export async function currentPeriod(config: ZeroConfig): Promise<bigint> {
  // Use the cluster clock, which is what the program checks against.
  const slot = await connection.getSlot()
  const time = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000)
  return periodAt(config, time)
}

export async function fetchEntitlement(owner: PublicKey, period: bigint): Promise<Entitlement | undefined> {
  const address = entitlementAddress(owner, period, programId)
  const info = await connection.getAccountInfo(address)
  if (!info || !info.owner.equals(programId)) return undefined
  return decodeEntitlement(address, Buffer.from(info.data))
}

/** zeroSOL held by `owner` and its SOL value at the pool's current rate. */
export async function fetchHoldings(owner: PublicKey) {
  const pool = await fetchStakePool(connection, stakePoolAddress)
  const ata = associatedTokenAddress(owner, pool.poolMint)
  const balance = await connection.getTokenAccountBalance(ata).catch(() => undefined)
  const poolTokens = BigInt(balance?.value.amount ?? '0')
  return { pool, poolTokens, stakeLamports: poolTokensToLamports(pool, poolTokens) }
}
