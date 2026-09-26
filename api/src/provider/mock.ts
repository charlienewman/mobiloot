// Deterministic, credential-free provider so anyone can clone and run the full flow.
// ICCIDs use the 89 99 test prefix and activation codes point at a non-existent SM-DP+.
import crypto from 'node:crypto'
import type { CreateOrderInput, MobileProvider, ProviderOrder, Usage } from './types'

export class MockProvider implements MobileProvider {
  readonly mode = 'mock' as const
  private orders = new Map<string, { order: ProviderOrder; createdAt: number }>()

  async createOrder({ idempotencyKey }: CreateOrderInput): Promise<ProviderOrder> {
    const id = 'mock_' + digest(idempotencyKey).slice(0, 16)
    const existing = this.orders.get(id)
    if (existing) return existing.order
    const order: ProviderOrder = {
      providerOrderId: id,
      status: 'ready',
      iccid:
        '8999' +
        BigInt('0x' + digest(id).slice(0, 14))
          .toString()
          .padStart(15, '0')
          .slice(0, 15),
      activationCode: `LPA:1$rsp.mock.zero.invalid$ZM-${digest(id + 'm')
        .slice(0, 20)
        .toUpperCase()}`,
    }
    this.orders.set(id, { order, createdAt: Date.now() })
    return order
  }

  async getOrder(providerOrderId: string): Promise<ProviderOrder> {
    const found = this.orders.get(providerOrderId)
    if (!found) throw new Error('unknown order')
    return found.order
  }

  readonly suspended = new Set<string>()
  async suspend(providerOrderId: string) {
    this.suspended.add(providerOrderId)
  }
  async resume(providerOrderId: string) {
    this.suspended.delete(providerOrderId)
  }

  async getUsage(providerOrderId: string, dataTotalMb: number): Promise<Usage> {
    // Usage grows smoothly from the order's creation so the Home screen moves over time.
    const createdAt = this.orders.get(providerOrderId)?.createdAt ?? Date.now()
    const days = (Date.now() - createdAt) / 86_400_000
    const seed = parseInt(digest(providerOrderId).slice(0, 4), 16) / 0xffff
    return {
      dataUsedMb: Math.min(dataTotalMb, Math.round(180 + days * (220 + seed * 120))),
      dataTotalMb,
      minutesUsed: Math.round(12 + days * 9),
      textsUsed: Math.round(4 + days * 3),
      updatedAt: new Date().toISOString(),
    }
  }
}

const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
