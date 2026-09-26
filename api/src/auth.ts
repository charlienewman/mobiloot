// Sign-in with a Solana wallet: the server issues a single-use, expiring message bound
// to its domain; the wallet signs it through Mobile Wallet Adapter; the server verifies
// the ed25519 signature against the exact stored message and consumes the nonce.
import crypto from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import type { Db } from './db'

const CHALLENGE_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 7 * 24 * 3600_000

export function createChallenge(db: Db, address: string, domain: string, chainId: string, now = Date.now()) {
  new PublicKey(address) // throws on malformed input
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = [
    `${domain} wants you to sign in with your Solana account:`,
    address,
    '',
    'Sign in to Zero Mobile by Shaka. This does not move any funds.',
    '',
    `URI: https://${domain}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(now).toISOString()}`,
    `Expiration Time: ${new Date(now + CHALLENGE_TTL_MS).toISOString()}`,
  ].join('\n')
  db.prepare('INSERT INTO challenges (nonce, address, message, expires_at) VALUES (?, ?, ?, ?)').run(
    nonce,
    address,
    message,
    now + CHALLENGE_TTL_MS,
  )
  return { nonce, message }
}

export class AuthError extends Error {}

export function verifyChallenge(db: Db, nonce: string, address: string, signature: string, now = Date.now()) {
  const row = db.prepare('SELECT address, message, expires_at FROM challenges WHERE nonce = ?').get(nonce) as
    | { address: string; message: string; expires_at: number }
    | undefined
  if (!row || row.address !== address) throw new AuthError('Unknown challenge')
  if (row.expires_at < now) throw new AuthError('Challenge expired')

  let sig: Uint8Array
  try {
    sig = decodeSignature(signature)
  } catch {
    throw new AuthError('Malformed signature')
  }
  const ok = nacl.sign.detached.verify(Buffer.from(row.message, 'utf8'), sig, new PublicKey(address).toBytes())
  if (!ok) throw new AuthError('Invalid signature')

  // Consume atomically so a replayed signature cannot mint a second session.
  const consumed = db.prepare('UPDATE challenges SET consumed_at = ? WHERE nonce = ? AND consumed_at IS NULL').run(now, nonce)
  if (consumed.changes !== 1) throw new AuthError('Challenge already used')

  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, address, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hash(token),
    address,
    now,
    now + SESSION_TTL_MS,
  )
  return { token, expiresAt: now + SESSION_TTL_MS }
}

export function sessionAddress(db: Db, token: string | undefined, now = Date.now()): string | undefined {
  if (!token) return undefined
  const row = db.prepare('SELECT address, expires_at FROM sessions WHERE token_hash = ?').get(hash(token)) as
    | { address: string; expires_at: number }
    | undefined
  return row && row.expires_at > now ? row.address : undefined
}

export function revokeSession(db: Db, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token))
}

function decodeSignature(s: string): Uint8Array {
  // 64 bytes is 86-88 chars in both base58 and base64, so tell them apart by alphabet.
  const bytes = /^[0-9a-fA-F]{128}$/.test(s)
    ? Buffer.from(s, 'hex')
    : /[+/=_-]/.test(s)
      ? Buffer.from(s, 'base64')
      : bs58.decode(s)
  if (bytes.length !== 64) throw new Error('bad length')
  return bytes
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
