// End-to-end smoke test of a live deployment: the hosted API and the on-chain programs
// together, happy and sad paths. Uses the payer (which holds the pool's seed lootSOL) as
// the subscriber and throwaway keypairs as strangers. Leaves the payer's lootSOL where
// it found it.
//
//   CLUSTER=devnet API_URL=https://api-production-e094.up.railway.app npm -w ops run smoke
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import nacl from 'tweetnacl'
import {
  TOKEN_PROGRAM_ID,
  activateIx,
  associatedTokenAddress,
  createAssociatedTokenAccountIdempotent,
  depositSolIx,
  fetchStakePool,
  mobilootErrorMessage,
  refreshIxs,
  withdrawSolIx,
} from '@mobiloot/shared'
import { formatSiwsMessage } from '../../api/src/auth'
import { CLUSTER, connection, loadConfig, payer, send } from './lib'

const API = process.env.API_URL ?? 'http://127.0.0.1:8787'
const config = loadConfig()
const stakePool = new PublicKey(config.stakePool)
let failures = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

/** Does what a wallet does: format the SIWS message from the challenge and sign it. */
async function signedChallenge(kp: Keypair, overrides: Record<string, string> = {}, signer = kp) {
  const ch = await call('POST', '/v1/auth/challenge', { body: {} })
  const message = formatSiwsMessage({ ...ch.json, ...overrides, address: kp.publicKey.toBase58() })
  return {
    address: kp.publicKey.toBase58(),
    signedMessage: b64(Buffer.from(message)),
    signature: b64(nacl.sign.detached(Buffer.from(message), signer.secretKey)),
  }
}

async function signIn(kp: Keypair) {
  const res = await call('POST', '/v1/auth/verify', { body: await signedChallenge(kp) })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.json)}`)
  return res.json.token as string
}

function tokenTransferIx(source: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(9)
  data.writeUInt8(3, 0) // SPL Token Transfer
  data.writeBigUInt64LE(amount, 1)
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  })
}

/** Sends and expects failure; returns the mapped program error (or raw text). */
async function expectTxError(label: string, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  try {
    const tx = new Transaction().add(...ixs)
    tx.feePayer = payer.publicKey
    await sendAndConfirmTransaction(connection, tx, [payer, ...signers], { commitment: 'confirmed' })
    console.log(`! ${label} unexpectedly succeeded`)
    return undefined
  } catch (e: any) {
    const logs: string[] = e.transactionLogs ?? e.logs ?? []
    return mobilootErrorMessage(e) ?? (String(e.message) + logs.join(' '))
  }
}

async function lootBalance(owner: PublicKey, mint: PublicKey) {
  const info = await connection.getTokenAccountBalance(associatedTokenAddress(owner, mint)).catch(() => undefined)
  return BigInt(info?.value.amount ?? 0)
}

async function main() {
  console.log(`smoke test: cluster=${CLUSTER} api=${API} subscriber=${payer.publicKey.toBase58()}\n`)

  // ---- API: public endpoints ----
  const health = await call('GET', '/v1/health')
  check('health', health.status === 200 && health.json.cluster === CLUSTER, JSON.stringify(health.json))
  const cfg = await call('GET', '/v1/config')
  check('config points at this pool', cfg.json.stakePool === config.stakePool)
  const pool = await call('GET', '/v1/pool')
  check('pool stats', pool.status === 200 && pool.json.exchangeRate >= 1, `rate ${pool.json.exchangeRate}`)
  const min = BigInt(cfg.json.minStakeLamports)

  // ---- API: auth sad paths ----
  const stranger = Keypair.generate()
  const attacker = Keypair.generate()
  check('no token → 401', (await call('GET', '/v1/me')).status === 401)
  check('garbage token → 401', (await call('GET', '/v1/me', { token: 'nope' })).status === 401)
  check('malformed verify body → 400', (await call('POST', '/v1/auth/verify', { body: { address: 1 } })).status === 400)
  const forged = await signedChallenge(stranger, {}, attacker)
  check('forged signature → 401', (await call('POST', '/v1/auth/verify', { body: forged })).status === 401)
  const wrongDomain = await signedChallenge(stranger, { domain: 'evil.example' })
  check('wrong domain → 401', (await call('POST', '/v1/auth/verify', { body: wrongDomain })).status === 401)
  const wrongChain = await signedChallenge(stranger, { chainId: 'solana:mainnet' })
  check('wrong chain → 401', (await call('POST', '/v1/auth/verify', { body: wrongChain })).status === 401)
  const good = await signedChallenge(stranger)
  const first = await call('POST', '/v1/auth/verify', { body: good })
  check('valid sign-in → 200', first.status === 200 && Boolean(first.json.token))
  check('replayed sign-in → 401', (await call('POST', '/v1/auth/verify', { body: good })).status === 401)

  // ---- API: a signed-in wallet with no plan ----
  const strangerToken = first.json.token as string
  const me0 = await call('GET', '/v1/me', { token: strangerToken })
  check('stranger /me has no entitlement', me0.status === 200 && !me0.json.entitlement)
  check('stranger eSIM order → 403', (await call('POST', '/v1/esim', { token: strangerToken, body: {} })).status === 403)
  check('stranger reveal → 404', (await call('POST', '/v1/esim/reveal', { token: strangerToken, body: {} })).status === 404)
  check('stranger usage → 404', (await call('GET', '/v1/usage', { token: strangerToken })).status === 404)
  await call('POST', '/v1/auth/logout', { token: strangerToken })
  check('logged-out token → 401', (await call('GET', '/v1/me', { token: strangerToken })).status === 401)

  // ---- Chain: program sad paths ----
  let state = await fetchStakePool(connection, stakePool)
  const mint = state.poolMint
  const token = await signIn(payer)
  let me = await call('GET', '/v1/me', { token })
  const period = BigInt(me.json.period)
  const payerAta = associatedTokenAddress(payer.publicKey, mint)
  check('subscriber holds enough lootSOL', BigInt(me.json.holdings.stakeLamports) >= min, `${me.json.holdings.stakeLamports} lamports`)

  const refresh = async () => refreshIxs(connection, (state = await fetchStakePool(connection, stakePool)))
  // The owner pays the entitlement's rent, so the stranger needs a little SOL to reach the checks.
  await send('fund stranger 0.01 SOL', [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: stranger.publicKey, lamports: 10_000_000 }),
  ])
  let err = await expectTxError('activate for the wrong period (expect fail)', [
    ...(await refresh()),
    activateIx({ owner: payer.publicKey, stakePool, holderTokens: payerAta, period: period + 1n }),
  ])
  check('program rejects wrong period', /not the current billing period/.test(err ?? ''), err)

  err = await expectTxError(
    "activate with someone else's lootSOL (expect fail)",
    [...(await refresh()), activateIx({ owner: stranger.publicKey, stakePool, holderTokens: payerAta, period })],
    [stranger],
  )
  check("program rejects someone else's token account", /belongs to someone else/.test(err ?? ''), err)

  const strangerAta = associatedTokenAddress(stranger.publicKey, mint)
  await send('create stranger lootSOL account', [createAssociatedTokenAccountIdempotent(payer.publicKey, stranger.publicKey, mint)])
  err = await expectTxError(
    'activate with no lootSOL (expect fail)',
    [...(await refresh()), activateIx({ owner: stranger.publicKey, stakePool, holderTokens: strangerAta, period })],
    [stranger],
  )
  check('program rejects insufficient stake', /Not enough lootSOL/.test(err ?? ''), err)

  // ---- Happy path: activate, eSIM, reveal, usage ----
  if (!me.json.entitlement) {
    await send('activate plan', [
      ...(await refresh()),
      activateIx({ owner: payer.publicKey, stakePool, holderTokens: payerAta, period }),
    ])
  } else console.log('• plan already active this period')
  err = await expectTxError('activate twice (expect fail)', [
    ...(await refresh()),
    activateIx({ owner: payer.publicKey, stakePool, holderTokens: payerAta, period }),
  ])
  check('program rejects a second activation', /already in use/.test(err ?? ''))

  me = await call('GET', '/v1/me', { token })
  check('API sees the entitlement', Boolean(me.json.entitlement), me.json.entitlement?.address)
  const order1 = await call('POST', '/v1/esim', { token, body: {} })
  check('eSIM ordered', order1.status === 200 && order1.json.status === 'ready', JSON.stringify(order1.json).slice(0, 120))
  const order2 = await call('POST', '/v1/esim', { token, body: {} })
  check('eSIM order is idempotent', order2.json.id === order1.json.id)
  check('order never exposes the activation code', !JSON.stringify(order1.json).includes('LPA:'))
  const reveal = await call('POST', '/v1/esim/reveal', { token, body: {} })
  check('reveal returns an LPA code', reveal.status === 200 && /^LPA:/.test(reveal.json.activationCode ?? ''))
  const usage = await call('GET', '/v1/usage', { token })
  check('usage', usage.status === 200, JSON.stringify(usage.json).slice(0, 100))

  // ---- Deposit and withdraw ----
  const before = await lootBalance(payer.publicKey, mint)
  await send('deposit 0.01 SOL', [...(await refresh()), depositSolIx(state, payer.publicKey, 10_000_000n)])
  const afterDeposit = await lootBalance(payer.publicKey, mint)
  check('deposit mints lootSOL', afterDeposit > before, `+${afterDeposit - before}`)
  await send('withdraw what was deposited', [
    ...(await refresh()),
    withdrawSolIx(state, payer.publicKey, afterDeposit - before),
  ])
  check('withdraw burns it again', (await lootBalance(payer.publicKey, mint)) === before)

  // ---- Coverage: move the stake away, the line suspends; move it back, it resumes ----
  const all = await lootBalance(payer.publicKey, mint)
  await send('move all lootSOL to another wallet', [tokenTransferIx(payerAta, strangerAta, payer.publicKey, all)])
  me = await call('GET', '/v1/me', { token })
  check('line suspends when the stake leaves', Boolean(me.json.esim?.suspended), JSON.stringify(me.json.esim).slice(0, 120))
  check('reveal refused while suspended', (await call('POST', '/v1/esim/reveal', { token, body: {} })).status === 403)
  await send('move it back', [tokenTransferIx(strangerAta, payerAta, stranger.publicKey, all)], [stranger])
  me = await call('GET', '/v1/me', { token })
  check('line resumes when the stake returns', me.json.esim && !me.json.esim.suspended)

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
