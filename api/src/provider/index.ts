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
}

export function createProviders(db: Db): Providers {
  const liveWallets = new Set(
    (env.LIVE_ESIM_WALLETS ?? '')
      .split(/[\s,]+/)
      .map((w) => w.trim())
      .filter(Boolean),
  )
  const live = env.SHAKA_API_KEY
    ? new ShakaLiveProvider(db, {
        baseUrl: env.SHAKA_BASE_URL,
        apiKey: env.SHAKA_API_KEY,
        planId: env.SHAKA_PLAN_ID,
        referencePrefix: env.SHAKA_REFERENCE_PREFIX ?? `mobiloot-${env.CLUSTER}`,
        webhookUrl: env.SHAKA_WEBHOOK_URL || undefined,
      })
    : undefined
  return { mock: new MockProvider(), live, liveWallets }
}
export type { MobileProvider } from './types'
