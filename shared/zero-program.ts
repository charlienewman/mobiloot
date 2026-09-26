// Hand-written client for the zero_mobile Anchor program (see anchor/programs/zero_mobile).
// Discriminators and layouts mirror anchor/target/idl/zero_mobile.json; the test suite
// checks them against the IDL so the two cannot drift silently.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'

export const ZERO_PROGRAM_ID = new PublicKey('ALt9aMm6fdhbtdRq9ftbdyQGKkFjoimGfRHNEMtHiWcp')
const BPF_UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')

export const DISCRIMINATORS = {
  activate: [194, 203, 35, 100, 151, 55, 170, 82],
  closeEntitlement: [130, 109, 177, 37, 184, 82, 11, 235],
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  updateConfig: [29, 158, 252, 191, 10, 83, 219, 99],
  Config: [155, 12, 170, 224, 30, 250, 204, 130],
  Entitlement: [220, 250, 27, 244, 55, 49, 74, 154],
} as const

export const ZERO_ERRORS: Record<number, string> = {
  6000: 'Only the program upgrade authority can do this',
  6001: 'Plan activations are paused',
  6002: 'That is not the current billing period',
  6003: 'Wrong stake pool',
  6004: 'That token account does not hold zeroSOL',
  6005: 'That token account belongs to someone else',
  6006: 'Not enough zeroSOL to fund this plan',
  6007: 'This billing period has not ended yet',
  6008: 'Invalid configuration',
  6009: 'Arithmetic overflow',
}

export interface ConfigParams {
  planCode: string
  minStakeLamports: bigint
  periodSeconds: number
  periodOrigin: bigint
  paused: boolean
}

export interface ZeroConfig extends ConfigParams {
  admin: PublicKey
  stakePoolProgram: PublicKey
  stakePool: PublicKey
  poolMint: PublicKey
}

export interface Entitlement {
  address: PublicKey
  owner: PublicKey
  period: bigint
  planCode: string
  poolTokens: bigint
  stakeLamports: bigint
  activatedAt: bigint
}

export function configAddress(programId = ZERO_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0]
}

export function entitlementAddress(owner: PublicKey, period: bigint, programId = ZERO_PROGRAM_ID): PublicKey {
  const p = Buffer.alloc(8)
  p.writeBigUInt64LE(period)
  return PublicKey.findProgramAddressSync([Buffer.from('entitlement'), owner.toBuffer(), p], programId)[0]
}

/** The billing period that contains `nowSeconds`. */
export function periodAt(config: Pick<ConfigParams, 'periodSeconds' | 'periodOrigin'>, nowSeconds: number): bigint {
  const elapsed = BigInt(Math.floor(nowSeconds)) - config.periodOrigin
  if (elapsed < 0n) return 0n
  return elapsed / BigInt(config.periodSeconds)
}

export function periodBounds(config: Pick<ConfigParams, 'periodSeconds' | 'periodOrigin'>, period: bigint) {
  const start = config.periodOrigin + period * BigInt(config.periodSeconds)
  return { start: Number(start), end: Number(start + BigInt(config.periodSeconds)) }
}

function planCodeBytes(code: string): Buffer {
  const b = Buffer.alloc(16)
  const src = Buffer.from(code, 'utf8')
  if (src.length > 16) throw new Error('plan code longer than 16 bytes')
  src.copy(b)
  return b
}

function planCodeString(b: Buffer): string {
  const end = b.indexOf(0)
  return b.subarray(0, end === -1 ? b.length : end).toString('utf8')
}

function encodeParams(p: ConfigParams): Buffer {
  const b = Buffer.alloc(16 + 8 + 4 + 8 + 1)
  planCodeBytes(p.planCode).copy(b, 0)
  b.writeBigUInt64LE(p.minStakeLamports, 16)
  b.writeUInt32LE(p.periodSeconds, 24)
  b.writeBigInt64LE(p.periodOrigin, 28)
  b.writeUInt8(p.paused ? 1 : 0, 36)
  return b
}

function checkDiscriminator(data: Buffer, expected: readonly number[], name: string) {
  if (data.length < 8 || !expected.every((v, i) => data[i] === v)) throw new Error(`Not a ${name} account`)
}

export function decodeConfig(data: Buffer): ZeroConfig {
  checkDiscriminator(data, DISCRIMINATORS.Config, 'Config')
  const key = (o: number) => new PublicKey(data.subarray(o, o + 32))
  return {
    admin: key(8),
    stakePoolProgram: key(40),
    stakePool: key(72),
    poolMint: key(104),
    planCode: planCodeString(data.subarray(136, 152)),
    minStakeLamports: data.readBigUInt64LE(152),
    periodSeconds: data.readUInt32LE(160),
    periodOrigin: data.readBigInt64LE(164),
    paused: data[172] === 1,
  }
}

export function decodeEntitlement(address: PublicKey, data: Buffer): Entitlement {
  checkDiscriminator(data, DISCRIMINATORS.Entitlement, 'Entitlement')
  return {
    address,
    owner: new PublicKey(data.subarray(8, 40)),
    period: data.readBigUInt64LE(40),
    planCode: planCodeString(data.subarray(48, 64)),
    poolTokens: data.readBigUInt64LE(64),
    stakeLamports: data.readBigUInt64LE(72),
    activatedAt: data.readBigInt64LE(80),
  }
}

const ro = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false })
const rw = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true })

export function activateIx(args: {
  owner: PublicKey
  stakePool: PublicKey
  holderTokens: PublicKey
  period: bigint
  programId?: PublicKey
}) {
  const programId = args.programId ?? ZERO_PROGRAM_ID
  const data = Buffer.alloc(16)
  Buffer.from(DISCRIMINATORS.activate).copy(data)
  data.writeBigUInt64LE(args.period, 8)
  return new TransactionInstruction({
    programId,
    keys: [
      rw(args.owner, true),
      ro(configAddress(programId)),
      ro(args.stakePool),
      ro(args.holderTokens),
      rw(entitlementAddress(args.owner, args.period, programId)),
      ro(SystemProgram.programId),
    ],
    data,
  })
}

export function closeEntitlementIx(owner: PublicKey, entitlement: PublicKey, programId = ZERO_PROGRAM_ID) {
  return new TransactionInstruction({
    programId,
    keys: [rw(owner, true), ro(configAddress(programId)), rw(entitlement)],
    data: Buffer.from(DISCRIMINATORS.closeEntitlement),
  })
}

export function initializeConfigIx(
  admin: PublicKey,
  stakePool: PublicKey,
  params: ConfigParams,
  programId = ZERO_PROGRAM_ID,
) {
  const programData = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_UPGRADEABLE_LOADER)[0]
  return new TransactionInstruction({
    programId,
    keys: [
      rw(admin, true),
      rw(configAddress(programId)),
      ro(stakePool),
      ro(programId),
      ro(programData),
      ro(SystemProgram.programId),
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATORS.initialize), encodeParams(params)]),
  })
}

export function updateConfigIx(admin: PublicKey, params: ConfigParams, programId = ZERO_PROGRAM_ID) {
  return new TransactionInstruction({
    programId,
    keys: [ro(admin, true), rw(configAddress(programId))],
    data: Buffer.concat([Buffer.from(DISCRIMINATORS.updateConfig), encodeParams(params)]),
  })
}

/** Extracts a zero_mobile custom error code from a failed transaction's logs or error. */
export function zeroErrorMessage(err: unknown): string | undefined {
  const text = String((err as any)?.message ?? err) + ' ' + ((err as any)?.logs ?? []).join(' ')
  const m = text.match(/custom program error: 0x([0-9a-f]+)/i) ?? text.match(/Error Number: (\d+)/)
  if (!m) return undefined
  const code = m[0].includes('0x') ? parseInt(m[1], 16) : Number(m[1])
  return ZERO_ERRORS[code]
}
