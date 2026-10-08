// Continuous coverage enforcement. An entitlement proves the wallet held enough lootSOL
// when it activated; this makes sure it *keeps* holding it. Without it, one stake could
// be passed wallet to wallet to back several lines in the same period. Each check
// suspends a line whose wallet no longer covers the plan and resumes it once it does,
// so a given stake backs at most one active line at a time. A live line also outlives
// its period, so one whose wallet hasn't unlocked the current period is suspended too.
import { PublicKey } from '@solana/web3.js'
import type { Db, OrderRow } from './db'
import type { MobileProvider } from './provider'

export interface CoverageDeps {
  db: Db
  providerByMode(mode: string): MobileProvider | undefined
  fetchHoldings(owner: PublicKey): Promise<{ stakeLamports: bigint }>
  /** Test-grant wallets, whose lines stand without stake. */
  exempt?(address: string): boolean
}

export function createCoverage({ db, providerByMode, fetchHoldings, exempt }: CoverageDeps) {
  /** Applies the rule to one order given the wallet's current stake; returns the updated row. */
  async function apply(order: OrderRow, stakeLamports: bigint, minLamports: bigint): Promise<OrderRow> {
    if (order.status !== 'ready' || !order.provider_order_id) return order
    const provider = providerByMode(order.provider_mode)
    if (!provider) return order
    const covered = stakeLamports >= minLamports || Boolean(exempt?.(order.address))
    if (!covered && !order.suspended_at) {
      await provider.suspend?.(order.provider_order_id)
      db.prepare('UPDATE orders SET suspended_at = ?, updated_at = ? WHERE id = ?').run(
        Date.now(),
        Date.now(),
        order.id,
      )
    } else if (covered && order.suspended_at) {
      await provider.resume?.(order.provider_order_id)
      db.prepare('UPDATE orders SET suspended_at = NULL, updated_at = ? WHERE id = ?').run(Date.now(), order.id)
    } else {
      return order
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as unknown as OrderRow
  }

  /** Re-checks every ready line for `period`. Run on a timer. */
  async function sweep(period: bigint, minLamports: bigint) {
    const orders = db
      .prepare("SELECT * FROM orders WHERE period = ? AND status = 'ready'")
      .all(Number(period)) as unknown as OrderRow[]
    let changed = 0
    for (const order of orders) {
      const { stakeLamports } = await fetchHoldings(new PublicKey(order.address))
      const updated = await apply(order, stakeLamports, minLamports)
      if (Boolean(updated.suspended_at) !== Boolean(order.suspended_at)) changed++
    }
    // Live lines from earlier periods whose wallet hasn't unlocked this one. The mock's
    // lines are per period, so they simply lapse.
    const lapsed = db
      .prepare(
        `SELECT provider_mode, provider_order_id, MAX(period) AS last FROM orders
         WHERE provider_mode != 'mock' AND status = 'ready' AND provider_order_id IS NOT NULL
         GROUP BY provider_mode, provider_order_id HAVING last < ?`,
      )
      .all(Number(period)) as { provider_mode: string; provider_order_id: string }[]
    for (const line of lapsed) await providerByMode(line.provider_mode)?.suspend?.(line.provider_order_id)
    return { checked: orders.length, changed, lapsed: lapsed.length }
  }

  return { apply, sweep }
}
