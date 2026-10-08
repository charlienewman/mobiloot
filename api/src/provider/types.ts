// Boundary between Mobiloot and a telecom provider. Provider-specific payloads are
// mapped to these shapes inside each adapter and never leak further into the app.
export interface CreateOrderInput {
  /** Wallet address that owns the line. */
  owner: string
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
  /** Installation details can be fetched with getActivation (not stored by Mobiloot). */
  hasActivation?: boolean
  /** The provider line is (or is being) suspended for coverage. */
  suspended?: boolean
  /** Safe, user-facing reason when status is failed. */
  error?: string
}

/** What the app needs to install the eSIM. Secret: never logged or cached. */
export interface Activation {
  activationCode: string
  smdpAddress: string | null
  matchingId: string | null
  /** Opens Android's own eSIM installer with the code filled in. */
  androidInstallUrl: string | null
  msisdn?: string | null
}

export interface Usage {
  dataUsedMb: number
  /** Null for unlimited data. */
  dataTotalMb: number | null
  minutesUsed: number
  textsUsed: number
  updatedAt: string
}

export interface MobileProvider {
  readonly mode: 'mock' | 'shaka_live'
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>
  getOrder(providerOrderId: string): Promise<ProviderOrder>
  getUsage(providerOrderId: string, dataTotalMb: number | null): Promise<Usage>
  /** Installation details fetched on demand, for providers that don't hand them over at order time. */
  getActivation?(providerOrderId: string): Promise<Activation>
  /** Bars the line (e.g. HLR/PCRF block) while the wallet no longer covers the plan. */
  suspend?(providerOrderId: string): Promise<void>
  resume?(providerOrderId: string): Promise<void>
}
