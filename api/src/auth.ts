// Sign In With Solana (SIWS). The server issues a single-use, expiring nonce and the
// fields of the message; the wallet formats and signs it during the Mobile Wallet
// Adapter `authorize` call, so connecting and signing in is one wallet handoff. The
// server verifies the ed25519 signature over the exact signed bytes, then checks that
// the domain, address, chain and nonce inside them are the ones it issued.
import crypto from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import type { Db } from './db'

const CHALLENGE_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 7 * 24 * 3600_000
export const SIWS_STATEMENT = 'Sign in to Zero Mobile by Shaka. This does not move any funds.'

export interface SiwsInput {
  domain: string
  statement: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt: string
  expirationTime: string
}

export class AuthError extends Error {}

export function createChallenge(db: Db, domain: string, chainId: string, now = Date.now()): SiwsInput {
  const input: SiwsInput = {
    domain,
    statement: SIWS_STATEMENT,
    uri: `https://${domain}`,
    version: '1',
    chainId,
    nonce: crypto.randomBytes(16).toString('hex'),
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + CHALLENGE_TTL_MS).toISOString(),
  }
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now - 3600_000)
  db.prepare('INSERT INTO challenges (nonce, address, message, expires_at) VALUES (?, ?, ?, ?)').run(
    input.nonce,
    '',
    JSON.stringify(input),
    now + CHALLENGE_TTL_MS,
  )
  return input
}

/** Canonical SIWS message text (the format wallets produce from the input fields). */
export function formatSiwsMessage(input: SiwsInput & { address: string }): string {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    '',
    input.statement,
    '',
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ].join('\n')
}

export function verifySignIn(
  db: Db,
  /** signedMessage and signature are base64, as returned by Mobile Wallet Adapter. */
  args: { address: string; signedMessage: string; signature: string },
  expectedDomain: string,
  now = Date.now(),
) {
  let address: PublicKey, message: Buffer, signature: Uint8Array
  try {
    address = new PublicKey(args.address)
    message = decodeBytes(args.signedMessage)
    signature = decodeBytes(args.signature)
    if (signature.length !== 64) throw new Error()
  } catch {
    throw new AuthError('Malformed sign-in')
  }
  if (!nacl.sign.detached.verify(message, signature, address.toBytes())) throw new AuthError('Invalid signature')

  const lines = message.toString('utf8').split('\n')
  const field = (name: string) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2)
  if (lines[0] !== `${expectedDomain} wants you to sign in with your Solana account:`)
    throw new AuthError('Wrong domain')
  if (lines[1] !== address.toBase58()) throw new AuthError('Address mismatch')
  const nonce = field('Nonce')
  if (!nonce) throw new AuthError('Missing nonce')

  const row = db.prepare('SELECT message, expires_at FROM challenges WHERE nonce = ?').get(nonce) as
    { message: string; expires_at: number } | undefined
  if (!row) throw new AuthError('Unknown challenge')
  if (row.expires_at < now) throw new AuthError('Challenge expired')
  const issued = JSON.parse(row.message) as SiwsInput
  if (field('Chain ID') !== issued.chainId) throw new AuthError('Wrong chain')
  if (field('URI') !== issued.uri) throw new AuthError('Wrong URI')

  // Consume atomically so a replayed signature cannot mint a second session.
  const consumed = db
    .prepare('UPDATE challenges SET consumed_at = ?, address = ? WHERE nonce = ? AND consumed_at IS NULL')
    .run(now, address.toBase58(), nonce)
  if (consumed.changes !== 1) throw new AuthError('Challenge already used')

  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, address, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hash(token),
    address.toBase58(),
    now,
    now + SESSION_TTL_MS,
  )
  return { token, address: address.toBase58(), expiresAt: now + SESSION_TTL_MS }
}

export function sessionAddress(db: Db, token: string | undefined, now = Date.now()): string | undefined {
  if (!token) return undefined
  const row = db.prepare('SELECT address, expires_at FROM sessions WHERE token_hash = ?').get(hash(token)) as
    { address: string; expires_at: number } | undefined
  return row && row.expires_at > now ? row.address : undefined
}

export function revokeSession(db: Db, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token))
}

function decodeBytes(s: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new Error('expected base64')
  return Buffer.from(s, 'base64')
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
