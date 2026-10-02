// Shaka sandbox adapter. Deliberately unimplemented: endpoint paths, auth scheme and
// payload fields must come from Shaka's sandbox documentation rather than be guessed.
// See docs/esim-provider.md for the contract this adapter has to satisfy.
import type { CreateOrderInput, MobileProvider, ProviderOrder, Usage } from './types'

export class ShakaSandboxProvider implements MobileProvider {
  readonly mode = 'shaka_sandbox' as const

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
    if (!baseUrl || !apiKey) throw new Error('SHAKA_SANDBOX_BASE_URL and SHAKA_SANDBOX_API_KEY are required')
  }

  async createOrder(_input: CreateOrderInput): Promise<ProviderOrder> {
    throw new NotWired('createOrder')
  }
  async getOrder(_providerOrderId: string): Promise<ProviderOrder> {
    throw new NotWired('getOrder')
  }
  async getUsage(_providerOrderId: string, _dataTotalMb: number): Promise<Usage> {
    throw new NotWired('getUsage')
  }
}

class NotWired extends Error {
  constructor(method: string) {
    super(`ShakaSandboxProvider.${method} is not wired to the sandbox API yet (docs/esim-provider.md)`)
  }
}
