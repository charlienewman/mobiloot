import { Connection, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ClusterConfig } from '@mobiloot/shared'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const CLUSTER = (process.env.CLUSTER ?? 'localnet') as ClusterConfig['cluster']
export const RPC_URL =
  process.env.RPC_URL ??
  { localnet: 'http://127.0.0.1:8899', devnet: 'https://api.devnet.solana.com', 'mainnet-beta': '' }[CLUSTER]
if (!RPC_URL) throw new Error(`Set RPC_URL for ${CLUSTER}`)

export const connection = new Connection(RPC_URL, 'confirmed')
export const configPath = path.join(ROOT, 'config', `${CLUSTER}.json`)
export const keysDir = path.join(ROOT, 'keys', CLUSTER)

export function readKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))))
}

/** Loads keys/<cluster>/<name>.json, generating it on first use. */
export function namedKeypair(name: string): Keypair {
  const file = path.join(keysDir, `${name}.json`)
  if (fs.existsSync(file)) return readKeypair(file)
  fs.mkdirSync(keysDir, { recursive: true })
  const kp = Keypair.generate()
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 })
  return kp
}

export const payer = readKeypair(process.env.PAYER ?? path.join(os.homedir(), '.config/solana/id.json'))

export function loadConfig(): ClusterConfig {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

export function saveConfig(config: Partial<ClusterConfig>) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}
  fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...config }, null, 2) + '\n')
}

export async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(...ixs)
  tx.feePayer = payer.publicKey
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, ...signers], { commitment: 'confirmed' })
    console.log(`✓ ${label}: ${sig}`)
    return sig
  } catch (e: any) {
    console.error(`✗ ${label}`)
    if (e.transactionLogs) console.error(e.transactionLogs.join('\n'))
    throw e
  }
}

export const sol = (lamports: bigint | number) => (Number(lamports) / 1e9).toFixed(4)
