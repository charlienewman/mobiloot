import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ClusterConfig } from '@mobiloot/shared'

const ROOT = path.resolve(import.meta.dirname, '../..')

const Env = z.object({
  CLUSTER: z.enum(['localnet', 'devnet']).default('localnet'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  /** Set when running behind a reverse proxy so rate limits see real client IPs. */
  TRUST_PROXY: z.coerce.boolean().default(false),
  RPC_URL: z.string().optional(),
  /** Domain the sign-in message is bound to. */
  SIGN_IN_DOMAIN: z.string().default('mobiloot.com'),
  DB_PATH: z.string().default(path.join(ROOT, 'api/data/mobiloot.db')),
  PROVIDER_MODE: z.enum(['mock', 'shaka_sandbox']).default('mock'),
  SHAKA_SANDBOX_BASE_URL: z.string().optional(),
  SHAKA_SANDBOX_API_KEY: z.string().optional(),
  /** Keypair that pays for permissionless pool updates. Unset disables the crank. */
  CRANK_KEYPAIR: z.string().optional(),
  /** The same keypair as a JSON byte array, for hosts that only take env vars (Railway). */
  CRANK_KEYPAIR_JSON: z.string().optional(),
  SOL_USD_FALLBACK: z.coerce.number().default(150),
  MAINNET_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  /** Mainnet-like staking yield used where a test cluster cannot measure one. */
  REFERENCE_APY: z.coerce.number().default(0.068),
})

export const env = Env.parse(process.env)
if ((env.PROVIDER_MODE as string) === 'shaka_live') throw new Error('shaka_live is not supported')

export const cluster: ClusterConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config', `${env.CLUSTER}.json`), 'utf8'),
)
export const rpcUrl = env.RPC_URL ?? cluster.rpcUrl

function crankKeypairPath(): string | undefined {
  if (env.CRANK_KEYPAIR) return env.CRANK_KEYPAIR.replace(/^~/, os.homedir())
  return env.CLUSTER === 'localnet' ? path.join(os.homedir(), '.config/solana/id.json') : undefined
}

/** The crank's secret key bytes, from CRANK_KEYPAIR_JSON or the CRANK_KEYPAIR file. */
export function crankSecretKey(): Uint8Array | undefined {
  if (env.CRANK_KEYPAIR_JSON) return Uint8Array.from(JSON.parse(env.CRANK_KEYPAIR_JSON))
  const file = crankKeypairPath()
  if (!file || !fs.existsSync(file)) return undefined
  return Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')))
}
