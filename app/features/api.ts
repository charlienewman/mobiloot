import { API_URL } from '@/constants/env'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, "Can't reach Mobiloot right now. Check your connection.")
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`)
  return json as T
}

export interface Plan {
  code: string
  name: string
  tagline: string
  dataGb: number | 'unlimited'
  minutes: 'unlimited' | number
  texts: 'unlimited' | number
  coverage: string
  network: string
  /** Older servers send only a USD cost. */
  monthlyPriceGbp?: number
  monthlyCostUsd: number
}

export interface MobilootConfigResponse {
  cluster: 'localnet' | 'devnet' | 'mainnet-beta'
  rpcUrl: string
  stakePoolProgram: string
  stakePool: string
  poolMint: string
  treasury: string
  mobilootProgram: string
  /** Default provider; a wallet's own order says which one actually serves it. */
  providerMode: 'mock' | 'shaka_live'
  plan: Plan
  minStakeLamports: string
  paused: boolean
  period: { id: string; start: number; end: number; seconds: number }
  solUsd: { usd: number; source: string }
  gbpUsd?: number
}

export interface PoolStats {
  cluster: string
  epoch: number
  epochProgress: number
  totalStakedLamports: string
  lootSolSupply: string
  exchangeRate: number
  reserveLamports: string
  lastEpochRewardsLamports: string
  apy: number
  apySource: 'measured' | 'reference'
  treasuryEarnedLamports: string
  validators: { vote: string; activeLamports: string }[]
}

export interface EsimOrder {
  id: string
  status: 'pending' | 'ready' | 'failed'
  providerMode: 'mock' | 'shaka_live'
  planCode: string
  iccidLast4: string | null
  hasActivationCode: boolean
  /** Barred because the wallet's lootSOL no longer covers the plan. */
  suspended: boolean
  error: string | null
  createdAt: number
}

export interface Me {
  address: string
  /** This wallet gets a real eSIM rather than the demo one. */
  liveEsim?: boolean
  /** Allowed an eSIM without staking, for testing. */
  testGrant?: boolean
  period: string
  holdings: { poolTokens: string; stakeLamports: string }
  entitlement?: { address: string; period: string; planCode: string; stakeLamports: string; activatedAt: number }
  esim?: EsimOrder
}

export interface Usage {
  dataUsedMb: number
  /** Null for unlimited data. */
  dataTotalMb: number | null
  minutesUsed: number
  textsUsed: number
  updatedAt: string
}

export interface RevealedEsim {
  activationCode: string
  smdpAddress: string | null
  matchingId: string | null
  /** Opens Android's own eSIM installer with the code filled in. */
  androidInstallUrl: string | null
  msisdn?: string | null
}
