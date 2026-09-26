import { env } from '../env'
import { MockProvider } from './mock'
import { ShakaSandboxProvider } from './shaka-sandbox'
import type { MobileProvider } from './types'

export function createProvider(): MobileProvider {
  if (env.PROVIDER_MODE === 'shaka_sandbox') {
    return new ShakaSandboxProvider(env.SHAKA_SANDBOX_BASE_URL ?? '', env.SHAKA_SANDBOX_API_KEY ?? '')
  }
  return new MockProvider()
}
export type { MobileProvider } from './types'
