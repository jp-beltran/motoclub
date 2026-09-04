import type { StorageLike } from '../../src/features/bar/application/bar-repository'
import type { SqlDriver } from './driver'

/**
 * `StorageLike` over the `kv` table (see `schema.sql`). The only new data
 * code this server needs: `LocalBarRepository`'s `update()` already does
 * clone → mutate → revalidate → single write, so this class only has to
 * move bytes in and out of SQLite.
 *
 * The envelope `LocalBarRepository` writes — `{version:1,data}` — is stored
 * verbatim as text; this class never parses it, so the repository's "any
 * exception leaves the stored bytes identical" guarantee survives
 * unchanged, now backed by an `fsync` per commit (`schema.sql`'s
 * `synchronous = FULL`) instead of a browser's best-effort `localStorage`.
 */
export class SqliteStorage implements StorageLike {
  constructor(private readonly driver: SqlDriver) {}

  getItem(key: string): string | null {
    const row = this.driver.get('SELECT value FROM kv WHERE key = ?', [key])
    return row === undefined ? null : (row.value as string)
  }

  setItem(key: string, value: string): void {
    this.driver.run(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()],
    )
  }
}
