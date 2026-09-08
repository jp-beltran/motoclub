import type { StorageLike } from '../../src/features/bar/application/bar-repository'
import type { SqlDriver } from './driver'
import { insertHistoryEntry, pruneHistory } from './kv-history'

/**
 * `StorageLike` over the `kv` table (see `schema.sql`). The only new data
 * code this server needs: `LocalBarRepository`'s `update()` already does
 * clone → mutate → revalidate → single write, so this class only has to
 * move bytes in and out of SQLite — now into two tables, `kv` and the
 * gzip-compressed version history in `kv_history` (see `kv-history.ts`).
 *
 * The envelope `LocalBarRepository` writes — `{version:1,data}` — is stored
 * verbatim as text; this class never parses it, so the repository's "any
 * exception leaves the stored bytes identical" guarantee survives
 * unchanged — but *how* it survives changed with this class's shape, and
 * that change is worth stating explicitly rather than assuming it away:
 *
 * Before Fase 4, `setItem` was a single `INSERT ... ON CONFLICT`, and its
 * atomicity came free from SQLite's own autocommit — one statement is
 * inherently all-or-nothing, no explicit transaction needed. `setItem` now
 * issues three statements (the `kv` upsert, the `kv_history` insert, the
 * retention prune), so that guarantee would no longer hold on its own: a
 * failure between statements could leave `kv` updated with no matching
 * history row, or a history row inserted while the prune that was
 * supposed to run right after it never did. `driver.transaction(...)`
 * (see `driver.ts`) is what restores the single-statement-era guarantee
 * for this now-multi-statement write: every statement inside it commits
 * together (one `fsync`, same as before — `synchronous = FULL` still
 * fires once per `setItem` call, not three times) or, on any throw
 * (including one SQLite itself raises), none of them do, and the previous
 * `kv` bytes for this key are exactly what a caller reading them back
 * afterwards sees. The observable behaviour a caller of `setItem` depends
 * on is unchanged; what changed is that it is now an explicit, tested
 * property (`sqlite-storage.test.ts`) instead of a free byproduct of
 * "there's only one statement here."
 */
export class SqliteStorage implements StorageLike {
  constructor(private readonly driver: SqlDriver) {}

  getItem(key: string): string | null {
    const row = this.driver.get('SELECT value FROM kv WHERE key = ?', [key])
    return row === undefined ? null : (row.value as string)
  }

  setItem(key: string, value: string): void {
    const writtenAt = new Date().toISOString()
    this.driver.transaction(() => {
      this.driver.run(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, writtenAt],
      )
      insertHistoryEntry(this.driver, key, value, writtenAt)
      pruneHistory(this.driver)
    })
  }
}
