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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (address, period, provider_mode)
    );
  `)
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
  created_at: number
  updated_at: number
}
