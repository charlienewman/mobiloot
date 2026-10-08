import type { Db } from '../db'
import { env } from '../env'
import { MockProvider } from './mock'
import { ShakaLiveProvider } from './shaka'
import type { MobileProvider } from './types'

export interface Providers {
  /** Everyone's provider unless their wallet is allowlisted for live eSIMs. */
  mock: MobileProvider
  live?: ShakaLiveProvider
  liveWallets: Set<string>
  /** Wallets that may order without staking (TEST_GRANT_WALLETS). */
  testWallets: Set<string>
}

const walletSet = (list: string | undefined) =>
  new Set(
    (list ?? '')
      .split(/[\s,]+/)
      .map((w) => w.trim())
      .filter(Boolean),
  )

export function createProviders(db: Db): Providers {
  const liveWallets = walletSet(env.LIVE_ESIM_WALLETS)
  const testWallets = walletSet(env.TEST_GRANT_WALLETS)
  const live = env.SHAKA_API_KEY
    ? new ShakaLiveProvider(db, {
        baseUrl: env.SHAKA_BASE_URL,
        apiKey: env.SHAKA_API_KEY,
        planId: env.SHAKA_PLAN_ID,
        referencePrefix: env.SHAKA_REFERENCE_PREFIX ?? `mobiloot-${env.CLUSTER}`,
        webhookUrl: env.SHAKA_WEBHOOK_URL || undefined,
      })
    : undefined
  return { mock: new MockProvider(), live, liveWallets, testWallets }
}
export type { MobileProvider } from './types'
