// End-to-end against a running localnet with the pool and program set up:
//   npm run localnet  &&  CLUSTER=localnet npm run pool:setup  &&  npm -w ops run setup:program
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { before, describe, test } from 'node:test'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import {
  activateIx,
  associatedTokenAddress,
  closeEntitlementIx,
  configAddress,
  createAssociatedTokenAccountIdempotent,
  decodeConfig,
  decodeEntitlement,
  depositSolIx,
  entitlementAddress,
  fetchStakePool,
  periodAt,
  refreshIxs,
  withdrawSolIx,
  zeroErrorMessage,
  type StakePoolState,
  type ZeroConfig,
} from '../index'

const cfgPath = path.resolve(import.meta.dirname, '../../config/localnet.json')
const connection = new Connection('http://127.0.0.1:8899', 'confirmed')
const reachable = await connection.getVersion().then(() => true, () => false)
const skip = !reachable ? 'localnet not running' : !fs.existsSync(cfgPath) ? 'pool not set up' : false

describe('zeroSOL + entitlement on localnet', { skip }, () => {
  let cluster: any
  let pool: StakePoolState
  let config: ZeroConfig
  let programId: PublicKey

  async function funded(sol: number) {
    const kp = Keypair.generate()
    const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(sig, 'confirmed')
    return kp
  }
  async function send(signer: Keypair, ...ixs: TransactionInstruction[]) {
    return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [signer], { commitment: 'confirmed' })
  }
  async function deposit(user: Keypair, sol: number) {
    pool = await fetchStakePool(connection, pool.address)
    await send(
      user,
      ...(await refreshIxs(connection, pool)),
      createAssociatedTokenAccountIdempotent(user.publicKey, user.publicKey, pool.poolMint),
      depositSolIx(pool, user.publicKey, BigInt(sol * LAMPORTS_PER_SOL)),
    )
  }
  const tokens = async (owner: PublicKey) =>
    BigInt((await connection.getTokenAccountBalance(associatedTokenAddress(owner, pool.poolMint))).value.amount)
  const period = () => periodAt(config, Date.now() / 1000)

  before(async () => {
    cluster = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    programId = new PublicKey(cluster.zeroProgram)
    pool = await fetchStakePool(connection, new PublicKey(cluster.stakePool))
    const info = await connection.getAccountInfo(configAddress(programId))
    assert.ok(info, 'program config missing: run npm -w ops run setup:program')
    config = decodeConfig(Buffer.from(info.data))
  })

  test('deposit mints zeroSOL 1:1 and activation records an entitlement', async () => {
    const user = await funded(5)
    await deposit(user, 2)
    const held = await tokens(user.publicKey)
    assert.ok(held > 1_990_000_000n && held <= 2_000_000_000n, `held ${held}`)

    const p = period()
    await send(user, activateIx({ owner: user.publicKey, stakePool: pool.address, holderTokens: associatedTokenAddress(user.publicKey, pool.poolMint), period: p, programId }))
    const addr = entitlementAddress(user.publicKey, p, programId)
    const ent = decodeEntitlement(addr, Buffer.from((await connection.getAccountInfo(addr))!.data))
    assert.ok(ent.owner.equals(user.publicKey))
    assert.equal(ent.period, p)
    assert.equal(ent.planCode, 'zero-essentials')
    assert.ok(ent.stakeLamports >= config.minStakeLamports)

    await assert.rejects(
      send(user, activateIx({ owner: user.publicKey, stakePool: pool.address, holderTokens: associatedTokenAddress(user.publicKey, pool.poolMint), period: p, programId })),
      /already in use/,
      'second activation in the same period must fail',
    )
    await assert.rejects(send(user, closeEntitlementIx(user.publicKey, addr, programId)), (e) => zeroErrorMessage(e) === 'This billing period has not ended yet')
  })

  test('rejects wallets without enough zeroSOL', async () => {
    const user = await funded(2)
    await deposit(user, 0.1)
    await assert.rejects(
      send(user, activateIx({ owner: user.publicKey, stakePool: pool.address, holderTokens: associatedTokenAddress(user.publicKey, pool.poolMint), period: period(), programId })),
      (e) => zeroErrorMessage(e) === 'Not enough zeroSOL to fund this plan',
    )
  })

  test("rejects someone else's token account and non-current periods", async () => {
    const whale = await funded(5)
    await deposit(whale, 2)
    const user = await funded(1)
    await assert.rejects(
      send(user, activateIx({ owner: user.publicKey, stakePool: pool.address, holderTokens: associatedTokenAddress(whale.publicKey, pool.poolMint), period: period(), programId })),
      (e) => zeroErrorMessage(e) === 'That token account belongs to someone else',
    )
    await assert.rejects(
      send(whale, activateIx({ owner: whale.publicKey, stakePool: pool.address, holderTokens: associatedTokenAddress(whale.publicKey, pool.poolMint), period: period() + 1n, programId })),
      (e) => zeroErrorMessage(e) === 'That is not the current billing period',
    )
  })

  test('withdrawal returns the principal', async () => {
    const user = await funded(3)
    await deposit(user, 1)
    const before = await connection.getBalance(user.publicKey)
    const held = await tokens(user.publicKey)
    pool = await fetchStakePool(connection, pool.address)
    await send(user, ...(await refreshIxs(connection, pool)), withdrawSolIx(pool, user.publicKey, held))
    const gained = (await connection.getBalance(user.publicKey)) - before
    assert.equal(await tokens(user.publicKey), 0n)
    assert.ok(gained > 0.999 * LAMPORTS_PER_SOL, `gained ${gained}`)
  })
})
