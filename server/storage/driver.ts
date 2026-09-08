/**
 * A minimal SQL driver port. `SqliteStorage` (and the boot assertions in
 * `config.ts`) talk only to this shape, never to `node:sqlite` directly, so
 * a `better-sqlite3` implementation is one file if an older Node ever forces
 * it — not written now: YAGNI, and the target machine is confirmed x64 with
 * a modern Mint that ships `node:sqlite`.
 */

/**
 * A single result row. SQLite is dynamically typed per column; `Uint8Array`
 * covers a `BLOB` column (`kv_history.value_gz` — see `kv-history.ts`),
 * which `node:sqlite` hands back as a `Buffer` (a `Uint8Array` subclass).
 */
export type SqlRow = Record<string, string | number | bigint | null | Uint8Array>

export interface SqlDriver {
  /** Runs one or more `;`-separated statements (schema, PRAGMAs). No results, no params. */
  exec(sql: string): void
  /** Runs a parameterised query and returns its first row, or `undefined` if there is none. */
  get(sql: string, params?: readonly unknown[]): SqlRow | undefined
  /** Runs a parameterised query and returns every matching row (empty array, never `undefined`, when nothing matches). */
  all(sql: string, params?: readonly unknown[]): SqlRow[]
  /** Runs a parameterised statement for its side effect. No result. */
  run(sql: string, params?: readonly unknown[]): void
  /**
   * Runs `fn` inside `BEGIN`/`COMMIT`. Every statement `fn` issues through
   * this same driver commits together, or — if `fn` throws, including a
   * throw from a statement inside it (a constraint violation SQLite itself
   * raises) — none of them do: `ROLLBACK` runs and the original error is
   * rethrown. This is what lets `SqliteStorage.setItem` write `kv` and
   * `kv_history` as one all-or-nothing unit (see that file's doc comment)
   * instead of relying on SQLite's own single-statement autocommit, which
   * only covers one statement at a time.
   */
  transaction<T>(fn: () => T): T
  /** Closes the underlying connection. Safe to call once, at shutdown. */
  close(): void
}

/**
 * Opens `path` with `node:sqlite`'s `DatabaseSync`.
 *
 * The `node:sqlite` module is loaded via a *dynamic* `import()` rather than
 * a static one deliberately: a static `import { DatabaseSync } from
 * 'node:sqlite'` at the top of this file would be resolved the moment
 * anything imports this module — before `config.ts`'s Node-version
 * assertion has a chance to run — and an unsupported Node would fail with a
 * raw "Cannot find module" stack trace instead of the actionable message
 * `assertSupportedNodeVersion` prints. Callers are expected to run that
 * assertion first and only then call this function.
 */
export async function openNodeSqliteDriver(path: string): Promise<SqlDriver> {
  const { DatabaseSync } = (await import('node:sqlite')) as typeof import('node:sqlite')
  const db = new DatabaseSync(path)

  return {
    exec(sql) {
      db.exec(sql)
    },
    get(sql, params = []) {
      return db.prepare(sql).get(...(params as never[])) as SqlRow | undefined
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...(params as never[])) as SqlRow[]
    },
    run(sql, params = []) {
      db.prepare(sql).run(...(params as never[]))
    },
    transaction(fn) {
      db.exec('BEGIN')
      let result: ReturnType<typeof fn>
      try {
        result = fn()
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // SQLite sometimes already rolled back on its own after certain
          // errors (e.g. a full-blown SQLITE_CORRUPT), which makes a bare
          // ROLLBACK throw "cannot rollback - no transaction is active".
          // That secondary failure must never shadow the real error below.
        }
        throw error
      }
      db.exec('COMMIT')
      return result
    },
    close() {
      db.close()
    },
  }
}
