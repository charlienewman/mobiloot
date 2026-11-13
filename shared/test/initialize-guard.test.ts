// Regression test for the audit finding "unchecked stake_pool owner in initialize".
// Starts its own throwaway validator (no existing config), preloads two pool-shaped
// accounts with identical bytes but different owners, and checks that initialize only
// accepts the one owned by the pinned stake pool program.
// Needs `solana-test-validator` and a built program (npm run program:build).
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { MOBILOOT_PROGRAM_ID, configAddress, decodeConfig, initializeConfigIx, mobilootErrorMessage } from '../index'

const STAKE_POOL_PROGRAM = new PublicKey('SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY')
const so = path.resolve(import.meta.dirname, '../../anchor/target/deploy/mobiloot.so')
const hasValidator = spawnSync('solana-test-validator', ['--version']).status === 0
const skip = !hasValidator ? 'solana-test-validator not installed' : !fs.existsSync(so) ? 'run anchor build first' : false

// Random ports per run, so a previous run's sockets (or the dev localnet) never clash.
const BASE_PORT = 20_000 + Math.floor(Math.random() * 400) * 100
const params = {
  planCode: 'loot-essentials',
  minStakeLamports: 500_000_000n,
  periodSeconds: 2_592_000,
  periodOrigin: 1_788_220_800n,
  paused: false,
}

/** Bytes that pass `read_pool`: account type 1 (StakePool) and a mint at offset 162. */
function poolBytes(mint: PublicKey) {
  const data = Buffer.alloc(611)
  data[0] = 1
  mint.toBuffer().copy(data, 162)
  return data
}

function accountFile(dir: string, name: string, pubkey: PublicKey, owner: PublicKey, data: Buffer) {
  const file = path.join(dir, `${name}.json`)
  fs.writeFileSync(
    file,
    JSON.stringify({
      pubkey: pubkey.toBase58(),
      account: {
        lamports: LAMPORTS_PER_SOL,
        data: [data.toString('base64'), 'base64'],
        owner: owner.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: data.length,
      },
    }),
  )
  return file
}

describe('initialize pins the stake pool program', { skip }, () => {
  let dir: string
  let validator: ChildProcess
  let exited = false
  // HTTP polling only (no websocket), so nothing keeps the process alive afterwards.
  const connection = new Connection(`http://127.0.0.1:${BASE_PORT}`, 'confirmed')
  const admin = Keypair.generate()
  const mint = Keypair.generate().publicKey
  const spoofed = Keypair.generate().publicKey
  const genuine = Keypair.generate().publicKey

  async function confirmed(signature: string) {
    for (let i = 0; i < 120; i++) {
      const { value } = await connection.getSignatureStatuses([signature])
      const status = value[0]
      if (status?.err) throw Object.assign(new Error(`transaction failed: ${JSON.stringify(status.err)}`), { logs: [] })
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`not confirmed: ${signature}`)
  }

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobiloot-guard-'))
    const adminFile = path.join(dir, 'admin.json')
    fs.writeFileSync(adminFile, JSON.stringify([...admin.secretKey]))
    const log = fs.openSync(path.join(dir, 'validator.log'), 'w')
    validator = spawn(
      'solana-test-validator',
      [
        '--ledger', path.join(dir, 'ledger'),
        '--rpc-port', String(BASE_PORT),
        '--faucet-port', String(BASE_PORT + 2),
        '--gossip-port', String(BASE_PORT + 3),
        '--dynamic-port-range', `${BASE_PORT + 10}-${BASE_PORT + 90}`,
        '--upgradeable-program', MOBILOOT_PROGRAM_ID.toBase58(), so, adminFile,
        '--account', spoofed.toBase58(), accountFile(dir, 'spoofed', spoofed, Keypair.generate().publicKey, poolBytes(mint)),
        '--account', genuine.toBase58(), accountFile(dir, 'genuine', genuine, STAKE_POOL_PROGRAM, poolBytes(mint)),
        '--quiet',
      ],
      { stdio: ['ignore', log, log] },
    )
    validator.on('exit', () => (exited = true))
    for (let i = 0; ; i++) {
      try {
        await connection.getLatestBlockhash()
        break
      } catch {
        if (exited || i > 120) {
          const tail = fs.readFileSync(path.join(dir, 'validator.log'), 'utf8').slice(-2000)
          throw new Error(`test validator did not start (log in ${dir}):\n${tail}`)
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    await confirmed(await connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL))
  })

  after(() => {
    validator?.kill('SIGKILL')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  async function init(pool: PublicKey) {
    const tx = new Transaction().add(initializeConfigIx(admin.publicKey, pool, params))
    tx.feePayer = admin.publicKey
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
    tx.sign(admin)
    // Preflight simulation surfaces program errors with their logs.
    await confirmed(await connection.sendRawTransaction(tx.serialize()))
  }

  test('rejects a pool-shaped account owned by another program', async () => {
    await assert.rejects(
      init(spoofed),
      (e) => mobilootErrorMessage(e) === 'That stake pool is not run by the trusted stake pool program.',
    )
    assert.equal(await connection.getAccountInfo(configAddress()), null)
  })

  test('accepts the same bytes owned by the stake pool program', async () => {
    await init(genuine)
    const config = decodeConfig(Buffer.from((await connection.getAccountInfo(configAddress()))!.data))
    assert.ok(config.stakePool.equals(genuine))
    assert.ok(config.stakePoolProgram.equals(STAKE_POOL_PROGRAM))
    assert.ok(config.poolMint.equals(mint))
  })
})
