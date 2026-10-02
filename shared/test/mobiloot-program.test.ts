// Keeps the hand-written client in lockstep with the Anchor IDL.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { DISCRIMINATORS, MOBILOOT_ERRORS, MOBILOOT_PROGRAM_ID, decodeConfig, periodAt, periodBounds } from '../mobiloot-program'

const idlPath = path.resolve(import.meta.dirname, '../../anchor/idl/mobiloot.json')
const idl = fs.existsSync(idlPath) ? JSON.parse(fs.readFileSync(idlPath, 'utf8')) : undefined

test('discriminators, errors and program id match the IDL', { skip: !idl && 'run anchor build first' }, () => {
  assert.equal(idl.address, MOBILOOT_PROGRAM_ID.toBase58())
  const camel = (s: string) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase())
  for (const ix of idl.instructions)
    assert.deepEqual([...(DISCRIMINATORS as any)[camel(ix.name)]], ix.discriminator, ix.name)
  for (const acct of idl.accounts)
    assert.deepEqual([...(DISCRIMINATORS as any)[acct.name]], acct.discriminator, acct.name)
  for (const err of idl.errors) assert.ok(MOBILOOT_ERRORS[err.code], `missing message for ${err.name}`)
})

test('decodes a Config account', () => {
  const data = Buffer.alloc(8 + 32 * 4 + 16 + 8 + 4 + 8 + 1 + 1)
  Buffer.from(DISCRIMINATORS.Config).copy(data)
  const keys = [1, 2, 3, 4].map((n) => new PublicKey(Buffer.alloc(32, n)))
  keys.forEach((k, i) => k.toBuffer().copy(data, 8 + i * 32))
  Buffer.from('loot-essentials').copy(data, 136)
  data.writeBigUInt64LE(500_000_000n, 152)
  data.writeUInt32LE(2_592_000, 160)
  data.writeBigInt64LE(1_788_220_800n, 164)
  const c = decodeConfig(data)
  assert.equal(c.planCode, 'loot-essentials')
  assert.equal(c.minStakeLamports, 500_000_000n)
  assert.ok(c.poolMint.equals(keys[3]))
  assert.equal(c.paused, false)
})

test('period arithmetic', () => {
  const cfg = { periodSeconds: 100, periodOrigin: 1000n }
  assert.equal(periodAt(cfg, 999), 0n)
  assert.equal(periodAt(cfg, 1000), 0n)
  assert.equal(periodAt(cfg, 1099), 0n)
  assert.equal(periodAt(cfg, 1100), 1n)
  assert.deepEqual(periodBounds(cfg, 2n), { start: 1200, end: 1300 })
})
