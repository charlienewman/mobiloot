import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS challenges (
      nonce TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      message TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      period INTEGER NOT NULL,
      plan_code TEXT NOT NULL,
      entitlement TEXT NOT NULL,
      provider_mode TEXT NOT NULL,
      provider_order_id TEXT,
      status TEXT NOT NULL,
      iccid TEXT,
      activation_code TEXT,
      error TEXT,
      suspended_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (address, period, provider_mode)
    );
    -- One live Shaka line per wallet; see provider/shaka.ts.
    CREATE TABLE IF NOT EXISTS shaka_lines (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      plan_id INTEGER NOT NULL,
      base_url TEXT NOT NULL,
      subscriber_ref TEXT NOT NULL,
      subscriber_key TEXT NOT NULL,
      subscriber_id INTEGER,
      subscription_ref TEXT NOT NULL UNIQUE,
      subscription_key TEXT NOT NULL,
      journey_id TEXT,
      journey_status TEXT,
      subscription_id INTEGER UNIQUE,
      sub_status TEXT,
      sim_status TEXT,
      iccid TEXT,
      state TEXT NOT NULL,
      suspend_wanted INTEGER NOT NULL DEFAULT 0,
      suspension_kind TEXT,
      suspension_seq INTEGER NOT NULL DEFAULT 0,
      suspension_key TEXT,
      suspension_journey_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_check_at INTEGER NOT NULL,
      last_error TEXT,
      last_request_id TEXT,
      synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- Verified Shaka webhook deliveries, for dedupe only (no payloads are kept).
    CREATE TABLE IF NOT EXISTS shaka_events (
      idempotency_id TEXT PRIMARY KEY,
      event_type TEXT,
      subscription_id INTEGER,
      ours INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    );
  `)
  // Databases created before coverage enforcement lack the column.
  try {
    db.exec('ALTER TABLE orders ADD COLUMN suspended_at INTEGER')
  } catch {}
  return db
}

export interface OrderRow {
  id: string
  address: string
  period: number
  plan_code: string
  entitlement: string
  provider_mode: string
  provider_order_id: string | null
  status: 'pending' | 'ready' | 'failed'
  iccid: string | null
  activation_code: string | null
  error: string | null
  suspended_at: number | null
  created_at: number
  updated_at: number
}
