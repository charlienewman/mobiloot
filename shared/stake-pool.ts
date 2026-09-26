// Minimal, program-id-aware client for SPL stake pool programs (the official SPoo1
// build and Sanctum's SP12t fork share the same instruction set and account layout).
// Depends only on @solana/web3.js so it runs unchanged in React Native, Node and tests.
import {
  Connection,
  PublicKey,
  StakeProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js'
import { Buffer } from 'buffer'

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
export const STAKE_CONFIG_ID = new PublicKey('StakeConfig11111111111111111111111111111111')

export enum Ix {
  Initialize = 0,
  AddValidatorToPool = 1,
  IncreaseValidatorStake = 4,
  UpdateValidatorListBalance = 6,
  UpdateStakePoolBalance = 7,
  CleanupRemovedValidatorEntries = 8,
  SetFee = 12,
  DepositSol = 14,
  WithdrawSol = 16,
  CreateTokenMetadata = 17,
}

export interface Fee {
  numerator: bigint
  denominator: bigint
}

export interface StakePoolState {
  address: PublicKey
  programId: PublicKey
  manager: PublicKey
  staker: PublicKey
  validatorList: PublicKey
  reserveStake: PublicKey
  poolMint: PublicKey
  managerFeeAccount: PublicKey
  tokenProgramId: PublicKey
  totalLamports: bigint
  poolTokenSupply: bigint
  lastUpdateEpoch: bigint
  epochFee: Fee
}

export interface ValidatorStakeInfo {
  activeStakeLamports: bigint
  transientStakeLamports: bigint
  lastUpdateEpoch: bigint
  transientSeedSuffix: bigint
  validatorSeedSuffix: number
  status: number
  voteAccount: PublicKey
}

// Fixed-offset fields of the Borsh-encoded StakePool account. Everything after the
// epoch fee sits behind variable-length enums, and nothing here needs it.
const POOL = {
  manager: 1,
  staker: 33,
  validatorList: 98,
  reserveStake: 130,
  poolMint: 162,
  managerFeeAccount: 194,
  tokenProgramId: 226,
  totalLamports: 258,
  poolTokenSupply: 266,
  lastUpdateEpoch: 274,
  epochFeeDenominator: 330,
  epochFeeNumerator: 338,
} as const
export const STAKE_POOL_ACCOUNT_SIZE = 611
const VALIDATOR_LIST_HEADER = 9
const VALIDATOR_STAKE_INFO_SIZE = 73

export function validatorListSize(maxValidators: number): number {
  return VALIDATOR_LIST_HEADER + VALIDATOR_STAKE_INFO_SIZE * maxValidators
}

const key = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32))

export function decodeStakePool(address: PublicKey, programId: PublicKey, data: Buffer): StakePoolState {
  if (data.length < STAKE_POOL_ACCOUNT_SIZE || data[0] !== 1) throw new Error('Not a stake pool account')
  return {
    address,
    programId,
    manager: key(data, POOL.manager),
    staker: key(data, POOL.staker),
    validatorList: key(data, POOL.validatorList),
    reserveStake: key(data, POOL.reserveStake),
    poolMint: key(data, POOL.poolMint),
    managerFeeAccount: key(data, POOL.managerFeeAccount),
    tokenProgramId: key(data, POOL.tokenProgramId),
    totalLamports: data.readBigUInt64LE(POOL.totalLamports),
    poolTokenSupply: data.readBigUInt64LE(POOL.poolTokenSupply),
    lastUpdateEpoch: data.readBigUInt64LE(POOL.lastUpdateEpoch),
    epochFee: {
      denominator: data.readBigUInt64LE(POOL.epochFeeDenominator),
      numerator: data.readBigUInt64LE(POOL.epochFeeNumerator),
    },
  }
}

export function decodeValidatorList(data: Buffer): ValidatorStakeInfo[] {
  if (data[0] !== 2) throw new Error('Not a validator list account')
  const count = data.readUInt32LE(5)
  const out: ValidatorStakeInfo[] = []
  for (let i = 0; i < count; i++) {
    const o = VALIDATOR_LIST_HEADER + i * VALIDATOR_STAKE_INFO_SIZE
    out.push({
      activeStakeLamports: data.readBigUInt64LE(o),
      transientStakeLamports: data.readBigUInt64LE(o + 8),
      lastUpdateEpoch: data.readBigUInt64LE(o + 16),
      transientSeedSuffix: data.readBigUInt64LE(o + 24),
      validatorSeedSuffix: data.readUInt32LE(o + 36),
      status: data[o + 40],
      voteAccount: key(data, o + 41),
    })
  }
  return out
}

export async function fetchStakePool(connection: Connection, address: PublicKey): Promise<StakePoolState> {
  const info = await connection.getAccountInfo(address)
  if (!info) throw new Error(`Stake pool ${address.toBase58()} not found`)
  return decodeStakePool(address, info.owner, Buffer.from(info.data))
}

export async function fetchValidatorList(connection: Connection, pool: StakePoolState) {
  const info = await connection.getAccountInfo(pool.validatorList)
  if (!info) throw new Error('Validator list not found')
  return decodeValidatorList(Buffer.from(info.data))
}

// ---------------------------------------------------------------------------
// Addresses

export function withdrawAuthority(programId: PublicKey, pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([pool.toBuffer(), Buffer.from('withdraw')], programId)[0]
}

export function validatorStakeAddress(programId: PublicKey, vote: PublicKey, pool: PublicKey, seed = 0): PublicKey {
  const seeds = [vote.toBuffer(), pool.toBuffer()]
  if (seed) seeds.push(u32(seed))
  return PublicKey.findProgramAddressSync(seeds, programId)[0]
}

export function transientStakeAddress(programId: PublicKey, vote: PublicKey, pool: PublicKey, seed: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('transient'), vote.toBuffer(), pool.toBuffer(), u64(seed)],
    programId,
  )[0]
}

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

export function createAssociatedTokenAccountIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  })
}

// ---------------------------------------------------------------------------
// Encoding helpers

function u32(n: number) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
function u64(n: bigint | number) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
function fee(f: Fee) {
  return Buffer.concat([u64(f.denominator), u64(f.numerator)])
}
function str(s: string) {
  const bytes = Buffer.from(s, 'utf8')
  return Buffer.concat([u32(bytes.length), bytes])
}
const ro = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false })
const rw = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true })

// ---------------------------------------------------------------------------
// User instructions

export function depositSolIx(pool: StakePoolState, from: PublicKey, lamports: bigint, destination?: PublicKey) {
  const dest = destination ?? associatedTokenAddress(from, pool.poolMint)
  return new TransactionInstruction({
    programId: pool.programId,
    keys: [
      rw(pool.address),
      ro(withdrawAuthority(pool.programId, pool.address)),
      rw(pool.reserveStake),
      rw(from, true),
      rw(dest),
      rw(pool.managerFeeAccount),
      rw(dest), // referrer: no referral programme, so fees (zero) route back to the depositor
      rw(pool.poolMint),
      ro(SystemProgram.programId),
      ro(pool.tokenProgramId),
    ],
    data: Buffer.concat([Buffer.from([Ix.DepositSol]), u64(lamports)]),
  })
}

export function withdrawSolIx(pool: StakePoolState, owner: PublicKey, poolTokens: bigint, receiver?: PublicKey) {
  return new TransactionInstruction({
    programId: pool.programId,
    keys: [
      rw(pool.address),
      ro(withdrawAuthority(pool.programId, pool.address)),
      ro(owner, true),
      rw(associatedTokenAddress(owner, pool.poolMint)),
      rw(pool.reserveStake),
      rw(receiver ?? owner),
      rw(pool.managerFeeAccount),
      rw(pool.poolMint),
      ro(SYSVAR_CLOCK_PUBKEY),
      ro(SYSVAR_STAKE_HISTORY_PUBKEY),
      ro(StakeProgram.programId),
      ro(pool.tokenProgramId),
    ],
    data: Buffer.concat([Buffer.from([Ix.WithdrawSol]), u64(poolTokens)]),
  })
}

// ---------------------------------------------------------------------------
// Permissionless epoch crank

export function updateIxs(pool: StakePoolState, validators: ValidatorStakeInfo[]): TransactionInstruction[] {
  const auth = withdrawAuthority(pool.programId, pool.address)
  const ixs: TransactionInstruction[] = []
  const CHUNK = 5
  for (let start = 0; start < validators.length || start === 0; start += CHUNK) {
    const chunk = validators.slice(start, start + CHUNK)
    ixs.push(
      new TransactionInstruction({
        programId: pool.programId,
        keys: [
          ro(pool.address),
          ro(auth),
          rw(pool.validatorList),
          rw(pool.reserveStake),
          ro(SYSVAR_CLOCK_PUBKEY),
          ro(SYSVAR_STAKE_HISTORY_PUBKEY),
          ro(StakeProgram.programId),
          ...chunk.flatMap((v) => [
            rw(validatorStakeAddress(pool.programId, v.voteAccount, pool.address, v.validatorSeedSuffix)),
            rw(transientStakeAddress(pool.programId, v.voteAccount, pool.address, v.transientSeedSuffix)),
          ]),
        ],
        data: Buffer.concat([Buffer.from([Ix.UpdateValidatorListBalance]), u32(start), Buffer.from([0])]),
      }),
    )
    if (validators.length === 0) break
  }
  ixs.push(
    new TransactionInstruction({
      programId: pool.programId,
      keys: [
        rw(pool.address),
        ro(auth),
        rw(pool.validatorList),
        ro(pool.reserveStake),
        rw(pool.managerFeeAccount),
        rw(pool.poolMint),
        ro(pool.tokenProgramId),
      ],
      data: Buffer.from([Ix.UpdateStakePoolBalance]),
    }),
    new TransactionInstruction({
      programId: pool.programId,
      keys: [rw(pool.address), rw(pool.validatorList)],
      data: Buffer.from([Ix.CleanupRemovedValidatorEntries]),
    }),
  )
  return ixs
}

// ---------------------------------------------------------------------------
// Manager / staker instructions (used by ops scripts only)

export function initializeIx(args: {
  programId: PublicKey
  pool: PublicKey
  manager: PublicKey
  staker: PublicKey
  validatorList: PublicKey
  reserveStake: PublicKey
  poolMint: PublicKey
  managerFeeAccount: PublicKey
  epochFee: Fee
  withdrawalFee: Fee
  depositFee: Fee
  referralFee: number
  maxValidators: number
}) {
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      rw(args.pool),
      ro(args.manager, true),
      ro(args.staker),
      ro(withdrawAuthority(args.programId, args.pool)),
      rw(args.validatorList),
      ro(args.reserveStake),
      rw(args.poolMint),
      rw(args.managerFeeAccount),
      ro(TOKEN_PROGRAM_ID),
    ],
    data: Buffer.concat([
      Buffer.from([Ix.Initialize]),
      fee(args.epochFee),
      fee(args.withdrawalFee),
      fee(args.depositFee),
      Buffer.from([args.referralFee]),
      u32(args.maxValidators),
    ]),
  })
}

export function addValidatorIx(pool: StakePoolState, vote: PublicKey, seed = 0) {
  return new TransactionInstruction({
    programId: pool.programId,
    keys: [
      rw(pool.address),
      ro(pool.staker, true),
      rw(pool.reserveStake),
      ro(withdrawAuthority(pool.programId, pool.address)),
      rw(pool.validatorList),
      rw(validatorStakeAddress(pool.programId, vote, pool.address, seed)),
      ro(vote),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SYSVAR_CLOCK_PUBKEY),
      ro(SYSVAR_STAKE_HISTORY_PUBKEY),
      ro(STAKE_CONFIG_ID),
      ro(SystemProgram.programId),
      ro(StakeProgram.programId),
    ],
    data: Buffer.concat([Buffer.from([Ix.AddValidatorToPool]), u32(seed)]),
  })
}

export function increaseValidatorStakeIx(
  pool: StakePoolState,
  validator: ValidatorStakeInfo,
  lamports: bigint,
  transientSeed: bigint,
) {
  return new TransactionInstruction({
    programId: pool.programId,
    keys: [
      ro(pool.address),
      ro(pool.staker, true),
      ro(withdrawAuthority(pool.programId, pool.address)),
      rw(pool.validatorList),
      rw(pool.reserveStake),
      rw(transientStakeAddress(pool.programId, validator.voteAccount, pool.address, transientSeed)),
      ro(validatorStakeAddress(pool.programId, validator.voteAccount, pool.address, validator.validatorSeedSuffix)),
      ro(validator.voteAccount),
      ro(SYSVAR_CLOCK_PUBKEY),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SYSVAR_STAKE_HISTORY_PUBKEY),
      ro(STAKE_CONFIG_ID),
      ro(SystemProgram.programId),
      ro(StakeProgram.programId),
    ],
    data: Buffer.concat([Buffer.from([Ix.IncreaseValidatorStake]), u64(lamports), u64(transientSeed)]),
  })
}

export function createTokenMetadataIx(
  pool: StakePoolState,
  payer: PublicKey,
  name: string,
  symbol: string,
  uri: string,
) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), pool.poolMint.toBuffer()],
    METADATA_PROGRAM_ID,
  )
  return new TransactionInstruction({
    programId: pool.programId,
    keys: [
      ro(pool.address),
      ro(pool.manager, true),
      ro(withdrawAuthority(pool.programId, pool.address)),
      ro(pool.poolMint),
      rw(payer, true),
      rw(metadata),
      ro(METADATA_PROGRAM_ID),
      ro(SystemProgram.programId),
    ],
    data: Buffer.concat([Buffer.from([Ix.CreateTokenMetadata]), str(name), str(symbol), str(uri)]),
  })
}

// ---------------------------------------------------------------------------
// Economics

/** SOL value (lamports) of an amount of pool tokens at the pool's current exchange rate. */
export function poolTokensToLamports(pool: StakePoolState, tokens: bigint): bigint {
  if (pool.poolTokenSupply === 0n) return tokens
  return (tokens * pool.totalLamports) / pool.poolTokenSupply
}

export function lamportsToPoolTokens(pool: StakePoolState, lamports: bigint): bigint {
  if (pool.totalLamports === 0n) return lamports
  return (lamports * pool.poolTokenSupply) / pool.totalLamports
}

/**
 * Update instructions to prepend to a user transaction when the pool has not yet been
 * updated this epoch (deposits and withdrawals are rejected until it has). This keeps
 * the app working even if nobody else has cranked the pool.
 */
export async function refreshIxs(connection: Connection, pool: StakePoolState): Promise<TransactionInstruction[]> {
  const { epoch } = await connection.getEpochInfo()
  if (pool.lastUpdateEpoch >= BigInt(epoch)) return []
  return updateIxs(pool, await fetchValidatorList(connection, pool))
}
