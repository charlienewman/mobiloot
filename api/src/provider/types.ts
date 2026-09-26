// Boundary between Zero Mobile and a telecom provider. Provider-specific payloads are
// mapped to these shapes inside each adapter and never leak further into the app.
export interface CreateOrderInput {
  planCode: string
  /** Stable per (wallet, period); the provider must return the same order on retry. */
  idempotencyKey: string
}

export interface ProviderOrder {
  providerOrderId: string
  status: 'pending' | 'ready' | 'failed'
  iccid?: string
  /** LPA activation string, e.g. "LPA:1$smdp.example.com$MATCHING-ID". Secret. */
  activationCode?: string
}

export interface Usage {
  dataUsedMb: number
  dataTotalMb: number
  minutesUsed: number
  textsUsed: number
  updatedAt: string
}

export interface MobileProvider {
  readonly mode: 'mock' | 'shaka_sandbox'
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>
  getOrder(providerOrderId: string): Promise<ProviderOrder>
  getUsage(providerOrderId: string, dataTotalMb: number): Promise<Usage>
}
