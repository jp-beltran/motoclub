import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeSqliteDriver, type SqlDriver } from './driver'

let workDir: string | undefined

function tempDbPath(): string {
  workDir = mkdtempSync(join(tmpdir(), 'driver-test-'))
  return join(workDir, 'bar.sqlite3')
}

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true })
    workDir = undefined
  }
})

async function openTestDriver(): Promise<SqlDriver> {
  const driver = await openNodeSqliteDriver(tempDbPath())
  driver.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
  return driver
}

describe('SqlDriver#all', () => {
  it('returns every matching row, not just the first', async () => {
    const driver = await openTestDriver()
    driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [1, 'a'])
    driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [2, 'b'])
    driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [3, 'c'])

    const rows = driver.all('SELECT id, value FROM t ORDER BY id')

    expect(rows).toEqual([
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
      { id: 3, value: 'c' },
    ])
    driver.close()
  })

  it('returns an empty array, not undefined or null, when nothing matches', async () => {
    const driver = await openTestDriver()

    expect(driver.all('SELECT * FROM t')).toEqual([])
    driver.close()
  })
})

describe('SqlDriver#transaction', () => {
  it('commits every statement together when the callback succeeds', async () => {
    const driver = await openTestDriver()

    const result = driver.transaction(() => {
      driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [1, 'a'])
      driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [2, 'b'])
      return 'done'
    })

    expect(result).toBe('done')
    expect(driver.all('SELECT id, value FROM t ORDER BY id')).toEqual([
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
    ])
    driver.close()
  })

  it('rolls back every statement in the callback when it throws, leaving prior rows untouched', async () => {
    const driver = await openTestDriver()
    driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [1, 'existing'])

    expect(() =>
      driver.transaction(() => {
        driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [2, 'should-not-stick'])
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(driver.all('SELECT id, value FROM t ORDER BY id')).toEqual([{ id: 1, value: 'existing' }])
    driver.close()
  })

  it('rolls back when a statement inside the callback itself throws (a constraint violation)', async () => {
    const driver = await openTestDriver()
    driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [1, 'existing'])

    expect(() =>
      driver.transaction(() => {
        driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [2, 'partial'])
        // Duplicate primary key — SQLite itself throws here, not our code.
        driver.run('INSERT INTO t (id, value) VALUES (?, ?)', [1, 'duplicate'])
      }),
    ).toThrow()

    expect(driver.all('SELECT id, value FROM t ORDER BY id')).toEqual([{ id: 1, value: 'existing' }])
    driver.close()
  })

  it('propagates the callback return value through the transaction', async () => {
    const driver = await openTestDriver()

    const value = driver.transaction(() => 42)

    expect(value).toBe(42)
    driver.close()
  })
})
