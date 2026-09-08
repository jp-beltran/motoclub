import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBarRepository } from '../../src/features/bar/infrastructure/local-bar-repository'
import { openNodeSqliteDriver, type SqlDriver } from './driver'
import { MAX_HISTORY_ENTRIES } from './kv-history'
import { SCHEMA_SQL } from './schema'
import { SqliteStorage } from './sqlite-storage'

let workDir: string | undefined

/** A fresh SQLite file inside a throwaway temp directory, schema applied. */
async function openTestDatabase(path: string): Promise<SqlDriver> {
  const driver = await openNodeSqliteDriver(path)
  driver.exec(SCHEMA_SQL)
  return driver
}

function tempDbPath(): string {
  workDir = mkdtempSync(join(tmpdir(), 'sqlite-storage-test-'))
  return join(workDir, 'bar.sqlite3')
}

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true })
    workDir = undefined
  }
})

describe('SqliteStorage', () => {
  it('round-trips a value written with setItem through getItem', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    storage.setItem('motoclub:bar-database', '{"version":1,"data":{}}')

    expect(storage.getItem('motoclub:bar-database')).toBe('{"version":1,"data":{}}')
    driver.close()
  })

  it('returns null, not undefined, for a key that was never written', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    expect(storage.getItem('never-written')).toBeNull()
    driver.close()
  })

  it('overwrites an existing key rather than erroring or duplicating it', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    storage.setItem('k', 'first')
    storage.setItem('k', 'second')

    expect(storage.getItem('k')).toBe('second')
    const row = driver.get('SELECT COUNT(*) as count FROM kv WHERE key = ?', ['k'])
    expect(row?.count).toBe(1)
    driver.close()
  })

  it('keeps a value after the database is closed and reopened from the same file', async () => {
    const path = tempDbPath()
    const firstDriver = await openTestDatabase(path)
    new SqliteStorage(firstDriver).setItem('motoclub:bar-database', 'persisted-value')
    firstDriver.close()

    expect(existsSync(path)).toBe(true)

    const secondDriver = await openNodeSqliteDriver(path)
    const reopened = new SqliteStorage(secondDriver)

    expect(reopened.getItem('motoclub:bar-database')).toBe('persisted-value')
    secondDriver.close()
  })

  it('passes PRAGMA integrity_check after many writes', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    for (let index = 0; index < 500; index += 1) {
      storage.setItem('motoclub:bar-database', JSON.stringify({ version: 1, data: { index } }))
    }

    const result = driver.get('PRAGMA integrity_check')
    expect(result?.integrity_check).toBe('ok')
    driver.close()
  })

  /**
   * The test that proves the whole design: LocalBarRepository — 689 LOC of
   * clone/mutate/revalidate transaction logic, unchanged — runs a real
   * mutation over SqliteStorage, and a *freshly opened* database (a new
   * driver, a new repository instance) sees it. This is what shows the
   * engine works over SQLite, not just that a key-value table works.
   */
  it('persists a LocalBarRepository mutation across a fresh database connection', async () => {
    const path = tempDbPath()
    const firstDriver = await openTestDatabase(path)
    const firstRepository = new LocalBarRepository({
      storage: new SqliteStorage(firstDriver),
      nextId: () => randomUUID(),
      now: () => new Date().toISOString(),
    })

    const created = await firstRepository.createVisitor({ name: 'Ana Torres' })
    firstDriver.close()

    const secondDriver = await openNodeSqliteDriver(path)
    const secondRepository = new LocalBarRepository({
      storage: new SqliteStorage(secondDriver),
      nextId: () => randomUUID(),
      now: () => new Date().toISOString(),
    })

    const consumers = await secondRepository.listConsumers()
    expect(consumers).toContainEqual(created)
    secondDriver.close()
  })

  it('records a history entry alongside the kv write, in the same call', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    storage.setItem('motoclub:bar-database', '{"version":1,"data":{}}')

    const row = driver.get('SELECT key, value_gz, written_at FROM kv_history')
    expect(row?.key).toBe('motoclub:bar-database')
    expect(gunzipSync(row?.value_gz as Uint8Array).toString('utf8')).toBe('{"version":1,"data":{}}')
    expect(typeof row?.written_at).toBe('string')
    driver.close()
  })

  it('appends one history row per setItem call — history accumulates across writes', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    storage.setItem('k', 'v1')
    storage.setItem('k', 'v2')
    storage.setItem('k', 'v3')

    expect(driver.get('SELECT COUNT(*) as count FROM kv_history')?.count).toBe(3)
    driver.close()
  })

  it('prunes history to the retention cap as an ordinary side effect of writing', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)

    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i += 1) {
      storage.setItem('motoclub:bar-database', JSON.stringify({ version: 1, data: { index: i } }))
    }

    expect(driver.get('SELECT COUNT(*) as count FROM kv_history')?.count).toBe(MAX_HISTORY_ENTRIES)
    driver.close()
  })

  /**
   * This is the property the whole design rests on (see this file's class
   * doc comment): a throw from `setItem` must leave the previously-stored
   * `kv` bytes exactly as they were — now proven across *two* tables
   * instead of one statement, which is exactly why `setItem` needs an
   * explicit transaction where the old single-statement version did not.
   * Forcing the failure by dropping `kv_history` out from under a live
   * `setItem` call is a deliberately blunt way to make the second
   * statement in the transaction fail without depending on any particular
   * gzip/compression behaviour.
   */
  it('leaves the kv row byte-identical when the history write fails partway through the transaction', async () => {
    const driver = await openTestDatabase(tempDbPath())
    const storage = new SqliteStorage(driver)
    storage.setItem('motoclub:bar-database', 'first-value')

    driver.exec('DROP TABLE kv_history')

    expect(() => storage.setItem('motoclub:bar-database', 'second-value-should-not-stick')).toThrow()
    expect(storage.getItem('motoclub:bar-database')).toBe('first-value')
    driver.close()
  })
})
