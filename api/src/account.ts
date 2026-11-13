// Account deletion. A wallet can ask for everything Mobiloot holds about it to be removed.
//
// A wallet with only demo (mock) orders is erased on the spot. One with a real mobile
// line cannot be: the line has to be closed with the network first, and the record is
// the only handle on it. Its line is suspended at once, its sessions and demo data are
// erased, and the rest is kept until the operator closes the line and runs `purge`.
import type { Db } from './db'

export function isClosing(db: Db, address: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM account_deletions WHERE address = ?').get(address))
}

/** Real lines this wallet has, as (provider mode, provider order id) pairs. */
export function liveLines(db: Db, address: string) {
  return db
    .prepare(
      `SELECT DISTINCT provider_mode, provider_order_id FROM orders
       WHERE address = ? AND provider_mode != 'mock' AND provider_order_id IS NOT NULL`,
    )
    .all(address) as { provider_mode: string; provider_order_id: string }[]
}

/** Erases everything except real-line records; marks the wallet as closing if any remain. */
export function eraseAccount(db: Db, address: string, now = Date.now()): 'deleted' | 'pending' {
  const pending = liveLines(db, address).length > 0
  db.prepare('DELETE FROM sessions WHERE address = ?').run(address)
  db.prepare('DELETE FROM challenges WHERE address = ?').run(address)
  db.prepare("DELETE FROM orders WHERE address = ? AND (provider_mode = 'mock' OR provider_order_id IS NULL)").run(
    address,
  )
  if (!pending) {
    db.prepare('DELETE FROM account_deletions WHERE address = ?').run(address)
    return 'deleted'
  }
  // The activation code is of no further use to a closing line.
  db.prepare('UPDATE orders SET activation_code = NULL, suspended_at = COALESCE(suspended_at, ?), updated_at = ? WHERE address = ?').run(
    now,
    now,
    address,
  )
  db.prepare('INSERT OR IGNORE INTO account_deletions (address, requested_at) VALUES (?, ?)').run(address, now)
  return 'pending'
}

/** Operator step, once the wallet's real line has been closed with the network. */
export function purgeAccount(db: Db, address: string) {
  const counts = {
    orders: db.prepare('DELETE FROM orders WHERE address = ?').run(address).changes,
    lines: db.prepare('DELETE FROM shaka_lines WHERE address = ?').run(address).changes,
    sessions: db.prepare('DELETE FROM sessions WHERE address = ?').run(address).changes,
    challenges: db.prepare('DELETE FROM challenges WHERE address = ?').run(address).changes,
    requests: db.prepare('DELETE FROM account_deletions WHERE address = ?').run(address).changes,
  }
  return counts
}

export function pendingDeletions(db: Db) {
  return db.prepare('SELECT address, requested_at FROM account_deletions ORDER BY requested_at').all() as {
    address: string
    requested_at: number
  }[]
}
