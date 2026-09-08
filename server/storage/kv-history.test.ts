import { gunzipSync } from 'node:zlib'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeSqliteDriver, type SqlDriver } from './driver'
import { SCHEMA_SQL } from './schema'
import { insertHistoryEntry, MAX_HISTORY_BYTES, MAX_HISTORY_ENTRIES, pruneHistory } from './kv-history'

let workDir: string | undefined

async function openTestDatabase(): Promise<SqlDriver> {
  workDir = mkdtempSync(join(tmpdir(), 'kv-history-test-'))
  const driver = await openNodeSqliteDriver(join(workDir, 'bar.sqlite3'))
  driver.exec(SCHEMA_SQL)
  return driver
}

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true })
    workDir = undefined
  }
})

function historyRows(driver: SqlDriver): { seq: number; key: string }[] {
  return driver.all('SELECT seq, key FROM kv_history ORDER BY seq') as unknown as {
    seq: number
    key: string
  }[]
}

describe('insertHistoryEntry', () => {
  it('stores the value gzip-compressed, recoverable byte-for-byte via gunzip', async () => {
    const driver = await openTestDatabase()
    const value = JSON.stringify({ version: 1, data: { consumers: [{ id: 'c1' }] } })

    insertHistoryEntry(driver, 'motoclub:bar-database', value, '2026-09-08T10:00:00.000Z')

    const row = driver.get('SELECT key, value_gz, written_at FROM kv_history')
    expect(row?.key).toBe('motoclub:bar-database')
    expect(row?.written_at).toBe('2026-09-08T10:00:00.000Z')
    const decompressed = gunzipSync(row?.value_gz as Uint8Array).toString('utf8')
    expect(decompressed).toBe(value)
    driver.close()
  })

  it('adds one row per call — history accumulates, it does not overwrite', async () => {
    const driver = await openTestDatabase()

    insertHistoryEntry(driver, 'k', 'v1', '2026-01-01T00:00:00.000Z')
    insertHistoryEntry(driver, 'k', 'v2', '2026-01-02T00:00:00.000Z')

    expect(driver.get('SELECT COUNT(*) as count FROM kv_history')?.count).toBe(2)
    driver.close()
  })

  it('actually compresses: gzip bytes are smaller than the JSON they came from, for realistic payloads', async () => {
    const driver = await openTestDatabase()
    // A long, repetitive-ish string — big enough that gzip's overhead
    // cannot possibly dominate, so this is a meaningful assertion rather
    // than a coin flip on a two-byte payload.
    const value = JSON.stringify({ version: 1, data: { note: 'x'.repeat(5000) } })

    insertHistoryEntry(driver, 'k', value, '2026-01-01T00:00:00.000Z')

    const row = driver.get('SELECT length(value_gz) as len FROM kv_history')
    expect(row?.len as number).toBeLessThan(Buffer.byteLength(value, 'utf8'))
    driver.close()
  })
})

describe('pruneHistory — count cap', () => {
  it(`keeps at most ${MAX_HISTORY_ENTRIES} entries, deleting the oldest first`, async () => {
    const driver = await openTestDatabase()
    const total = MAX_HISTORY_ENTRIES + 10
    for (let i = 0; i < total; i += 1) {
      insertHistoryEntry(driver, 'k', `v${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`)
    }

    pruneHistory(driver)

    const rows = historyRows(driver)
    expect(rows).toHaveLength(MAX_HISTORY_ENTRIES)
    // The oldest `total - MAX_HISTORY_ENTRIES` inserts are gone; the survivors
    // are the most recent ones (highest `seq`, i.e. the tail of the insert order).
    const survivingSeqs = rows.map((r) => r.seq)
    expect(Math.min(...survivingSeqs)).toBe(total - MAX_HISTORY_ENTRIES + 1)
    driver.close()
  })

  it('is a no-op when the table already fits under the cap', async () => {
    const driver = await openTestDatabase()
    insertHistoryEntry(driver, 'k', 'v1', '2026-01-01T00:00:00.000Z')
    insertHistoryEntry(driver, 'k', 'v2', '2026-01-01T00:00:01.000Z')

    pruneHistory(driver)

    expect(driver.get('SELECT COUNT(*) as count FROM kv_history')?.count).toBe(2)
    driver.close()
  })
})

describe('pruneHistory — byte budget', () => {
  it('keeps total compressed bytes under an explicit maxBytes override, deleting the oldest first even under the count cap', async () => {
    const driver = await openTestDatabase()
    // Low-compressibility payloads (hex digits, 4 bits of entropy per
    // char) so each entry's compressed size is predictable enough to
    // reason about against a small, test-only byte budget — this proves
    // the byte cap can bind well before MAX_HISTORY_ENTRIES does, which is
    // exactly the scenario a big imported database creates in production.
    const bigValue = Array.from({ length: 5000 }, (_, i) => (i % 16).toString(16)).join('')
    for (let i = 1; i <= 10; i += 1) {
      insertHistoryEntry(driver, 'k', bigValue + i, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`)
    }
    const singleEntryBytes = driver.get('SELECT length(value_gz) as len FROM kv_history WHERE seq = 1')
      ?.len as number
    // Budget for ~3 entries' worth of compressed bytes.
    const maxBytes = singleEntryBytes * 3

    pruneHistory(driver, { maxEntries: MAX_HISTORY_ENTRIES, maxBytes })

    const rows = driver.all('SELECT seq, length(value_gz) as len FROM kv_history ORDER BY seq') as unknown as {
      seq: number
      len: number
    }[]
    const totalAfter = rows.reduce((sum, r) => sum + r.len, 0)
    expect(totalAfter).toBeLessThanOrEqual(maxBytes)
    expect(rows.length).toBeLessThan(10)
    // The most recent entry (seq 10, the last inserted) must always survive
    // a byte-budget prune — otherwise the very write that triggered pruning
    // would delete itself.
    expect(rows.some((r) => r.seq === 10)).toBe(true)
    driver.close()
  })

  it('defaults to MAX_HISTORY_BYTES when no override is given', async () => {
    const driver = await openTestDatabase()
    const value = 'small value'
    insertHistoryEntry(driver, 'k', value, '2026-01-01T00:00:00.000Z')
    // Confirms the default is generous enough that this test's tiny entry
    // is nowhere near it — this is a real assertion on the constant
    // itself, not just a comment claiming so.
    expect(MAX_HISTORY_BYTES).toBeGreaterThan(Buffer.byteLength(value) * 1000)

    pruneHistory(driver)

    expect(driver.get('SELECT COUNT(*) as count FROM kv_history')?.count).toBe(1)
    driver.close()
  })
})
