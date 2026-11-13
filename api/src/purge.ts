// Operator tool for account deletion requests from wallets with a real line.
//   npm -w api run purge              lists wallets waiting for their line to be closed
//   npm -w api run purge -- <wallet>  erases the wallet's remaining records
// Close the line with the network BEFORE purging: the records are the only handle on it.
import { pendingDeletions, purgeAccount } from './account'
import { openDb } from './db'

const db = openDb(process.env.DB_PATH ?? 'data/mobiloot.db')
const address = process.argv[2]
if (!address) {
  const rows = pendingDeletions(db)
  if (!rows.length) console.log('No deletion requests are waiting.')
  for (const r of rows) {
    const lines = db.prepare('SELECT subscription_id, iccid FROM shaka_lines WHERE address = ?').all(r.address)
    console.log(r.address, new Date(r.requested_at).toISOString(), JSON.stringify(lines))
  }
} else {
  console.log(purgeAccount(db, address))
}
