// Initializes (or updates) the zero_mobile program config for a cluster.
//   CLUSTER=localnet npm -w ops run setup:program
// The payer must be the program's upgrade authority.
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ZERO_PROGRAM_ID,
  configAddress,
  decodeConfig,
  initializeConfigIx,
  updateConfigIx,
  type ConfigParams,
} from '@zero/shared'
import { Buffer } from 'buffer'
import { CLUSTER, connection, loadConfig, payer, saveConfig, send } from './lib'

const config = loadConfig()
const programId = new PublicKey(process.env.ZERO_PROGRAM ?? config.zeroProgram ?? ZERO_PROGRAM_ID)

const params: ConfigParams = {
  planCode: 'zero-essentials',
  // Mainnet would size this so the pool's yield covers the plan's wholesale cost
  // (see docs/economics.md). Test clusters use a low bar so anyone can try it.
  minStakeLamports: BigInt(
    Math.round(Number(process.env.MIN_STAKE_SOL ?? (CLUSTER === 'localnet' ? 1 : 0.5)) * LAMPORTS_PER_SOL),
  ),
  periodSeconds: Number(process.env.PERIOD_SECONDS ?? 30 * 24 * 3600),
  periodOrigin: BigInt(process.env.PERIOD_ORIGIN ?? 1788220800), // 2026-09-01T00:00:00Z
  paused: false,
}

const existing = await connection.getAccountInfo(configAddress(programId))
if (existing) {
  const current = decodeConfig(Buffer.from(existing.data))
  console.log('• config exists', {
    ...current,
    admin: current.admin.toBase58(),
    stakePool: current.stakePool.toBase58(),
  })
  if (process.argv.includes('--update'))
    await send('update config', [updateConfigIx(payer.publicKey, params, programId)])
} else {
  await send('initialize config', [
    initializeConfigIx(payer.publicKey, new PublicKey(config.stakePool), params, programId),
  ])
}
saveConfig({ zeroProgram: programId.toBase58() })
console.log(`config ${configAddress(programId).toBase58()} for program ${programId.toBase58()}`)
