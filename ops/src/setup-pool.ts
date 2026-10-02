// Creates the lootSOL stake pool and writes its public addresses to config/<cluster>.json.
// Re-runnable: keypairs persist in keys/<cluster>/ and finished steps are skipped.
//
//   CLUSTER=localnet npm run pool:setup
//   CLUSTER=devnet VOTES=<vote>[,<vote>] SEED_SOL=1.6 npm run pool:setup
//
// Economics: the epoch fee is 100%, so every staking reward the pool earns is minted
// as lootSOL to the Mobiloot treasury. Depositors keep their principal (1 lootSOL stays
// worth ~1 SOL) and can withdraw at any time with no fee.
import { LAMPORTS_PER_SOL, PublicKey, StakeProgram, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import {
  STAKE_POOL_ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  addValidatorIx,
  associatedTokenAddress,
  createAssociatedTokenAccountIdempotent,
  createTokenMetadataIx,
  depositSolIx,
  fetchStakePool,
  fetchValidatorList,
  increaseValidatorStakeIx,
  initializeIx,
  validatorListSize,
  withdrawAuthority,
  type ClusterConfig,
} from '@mobiloot/shared'
import { CLUSTER, RPC_URL, connection, namedKeypair, payer, saveConfig, send, sol } from './lib'

// Sanctum's SPL stake pool fork. The official SPoo1 deployment on devnet predates the
// 1 SOL minimum delegation and can no longer add validators; mainnet can use either.
const PROGRAM_ID = new PublicKey(process.env.STAKE_POOL_PROGRAM ?? 'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY')
const SEED_SOL = Number(process.env.SEED_SOL ?? (CLUSTER === 'localnet' ? 20 : 1.6))
const MAX_VALIDATORS = 10
const METADATA_URI = process.env.METADATA_URI ?? 'https://mobiloot.com/lootsol.json'

const treasury = namedKeypair('treasury')
const poolKp = namedKeypair('pool')
const mintKp = namedKeypair('mint')
const reserveKp = namedKeypair('reserve')
const listKp = namedKeypair('validator-list')
const pool = poolKp.publicKey
const auth = withdrawAuthority(PROGRAM_ID, pool)

async function votes(): Promise<PublicKey[]> {
  if (process.env.VOTES) return process.env.VOTES.split(',').map((v) => new PublicKey(v.trim()))
  if (CLUSTER !== 'localnet') throw new Error('Set VOTES to the validator vote account(s) to delegate to')
  const { current } = await connection.getVoteAccounts()
  return [new PublicKey(current[0].votePubkey)]
}

function initializeMint2(mint: PublicKey, authority: PublicKey, decimals: number) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([20, decimals]), authority.toBuffer(), Buffer.from([0])]),
  })
}

async function createPool() {
  if (await connection.getAccountInfo(pool)) {
    console.log('• pool exists, skipping creation')
    return
  }
  const rent = (n: number) => connection.getMinimumBalanceForRentExemption(n)
  // The pool program requires the reserve to hold strictly more than its rent exemption.
  const reserveLamports = (await rent(StakeProgram.space)) + 1

  await send(
    'create reserve, mint and treasury fee account',
    [
      ...StakeProgram.createAccount({
        fromPubkey: payer.publicKey,
        stakePubkey: reserveKp.publicKey,
        authorized: { staker: auth, withdrawer: auth },
        lamports: reserveLamports,
      }).instructions,
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        lamports: await rent(82),
        space: 82,
        programId: TOKEN_PROGRAM_ID,
      }),
      initializeMint2(mintKp.publicKey, auth, 9),
      createAssociatedTokenAccountIdempotent(payer.publicKey, treasury.publicKey, mintKp.publicKey),
    ],
    [reserveKp, mintKp],
  )

  const listSize = validatorListSize(MAX_VALIDATORS)
  await send(
    'initialize stake pool',
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: pool,
        lamports: await rent(STAKE_POOL_ACCOUNT_SIZE),
        space: STAKE_POOL_ACCOUNT_SIZE,
        programId: PROGRAM_ID,
      }),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: listKp.publicKey,
        lamports: await rent(listSize),
        space: listSize,
        programId: PROGRAM_ID,
      }),
      initializeIx({
        programId: PROGRAM_ID,
        pool,
        manager: treasury.publicKey,
        staker: treasury.publicKey,
        validatorList: listKp.publicKey,
        reserveStake: reserveKp.publicKey,
        poolMint: mintKp.publicKey,
        managerFeeAccount: associatedTokenAddress(treasury.publicKey, mintKp.publicKey),
        epochFee: { numerator: 100n, denominator: 100n },
        withdrawalFee: { numerator: 0n, denominator: 100n },
        depositFee: { numerator: 0n, denominator: 100n },
        referralFee: 0,
        maxValidators: MAX_VALIDATORS,
      }),
    ],
    [poolKp, listKp, treasury],
  )

  const state = await fetchStakePool(connection, pool)
  try {
    await send(
      'create lootSOL token metadata',
      [createTokenMetadataIx(state, payer.publicKey, 'Mobiloot Staked SOL', 'lootSOL', METADATA_URI)],
      [treasury],
    )
  } catch {
    console.warn('! token metadata skipped (metadata program unavailable?)')
  }
}

async function attachValidators() {
  let state = await fetchStakePool(connection, pool)
  let list = await fetchValidatorList(connection, state)
  const wanted = await votes()
  const missing = wanted.filter((v) => !list.some((l) => l.voteAccount.equals(v)))
  if (missing.length === 0) {
    console.log(`• validators already attached: ${list.map((l) => l.voteAccount.toBase58()).join(', ')}`)
    return
  }

  // Seed the reserve. Adding a validator moves the stake minimum (1 SOL + rent) out of it.
  await send(`deposit ${SEED_SOL} SOL seed liquidity`, [
    createAssociatedTokenAccountIdempotent(payer.publicKey, payer.publicKey, state.poolMint),
    depositSolIx(state, payer.publicKey, BigInt(Math.round(SEED_SOL * LAMPORTS_PER_SOL))),
  ])
  for (const vote of missing) {
    await send(`add validator ${vote.toBase58()}`, [addValidatorIx(state, vote)], [treasury])
  }

  // Delegate what is left in the reserve above a withdrawal buffer.
  state = await fetchStakePool(connection, pool)
  list = await fetchValidatorList(connection, state)
  const reserve = BigInt(await connection.getBalance(state.reserveStake))
  const buffer = BigInt(
    Math.round(Number(process.env.RESERVE_BUFFER_SOL ?? (CLUSTER === 'localnet' ? 2 : 0.1)) * LAMPORTS_PER_SOL),
  )
  const minDelegation = BigInt((await connection.getStakeMinimumDelegation()).value)
  const perValidator = (reserve - buffer) / BigInt(list.length)
  if (perValidator < minDelegation) {
    console.log(
      `• reserve ${sol(reserve)} SOL too small to delegate further (need ${sol(minDelegation)} per validator)`,
    )
    return
  }
  for (const v of list) {
    await send(
      `delegate ${sol(perValidator)} SOL to ${v.voteAccount.toBase58()}`,
      [increaseValidatorStakeIx(state, v, perValidator, v.transientSeedSuffix)],
      [treasury],
    )
  }
}

async function main() {
  console.log(`cluster=${CLUSTER} rpc=${RPC_URL} program=${PROGRAM_ID.toBase58()}`)
  console.log(`payer=${payer.publicKey.toBase58()} balance=${sol(await connection.getBalance(payer.publicKey))} SOL`)
  await createPool()
  await attachValidators()
  const state = await fetchStakePool(connection, pool)
  const list = await fetchValidatorList(connection, state)
  const config: ClusterConfig = {
    cluster: CLUSTER,
    rpcUrl: RPC_URL!,
    stakePoolProgram: PROGRAM_ID.toBase58(),
    stakePool: pool.toBase58(),
    poolMint: state.poolMint.toBase58(),
    reserveStake: state.reserveStake.toBase58(),
    validatorList: state.validatorList.toBase58(),
    treasury: treasury.publicKey.toBase58(),
    treasuryFeeAccount: state.managerFeeAccount.toBase58(),
    validatorVotes: list.map((v) => v.voteAccount.toBase58()),
  }
  saveConfig(config)
  console.log(JSON.stringify(config, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
