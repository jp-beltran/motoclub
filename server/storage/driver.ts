/**
 * A minimal SQL driver port. `SqliteStorage` (and the boot assertions in
 * `config.ts`) talk only to this shape, never to `node:sqlite` directly, so
 * a `better-sqlite3` implementation is one file if an older Node ever forces
 * it — not written now: YAGNI, and the target machine is confirmed x64 with
 * a modern Mint that ships `node:sqlite`.
 */

/** A single result row. SQLite is dynamically typed per column. */
export type SqlRow = Record<string, string | number | bigint | null>

export interface SqlDriver {
  /** Runs one or more `;`-separated statements (schema, PRAGMAs). No results, no params. */
  exec(sql: string): void
  /** Runs a parameterised query and returns its first row, or `undefined` if there is none. */
  get(sql: string, params?: readonly unknown[]): SqlRow | undefined
  /** Runs a parameterised statement for its side effect. No result. */
  run(sql: string, params?: readonly unknown[]): void
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
    run(sql, params = []) {
      db.prepare(sql).run(...(params as never[]))
    },
    close() {
      db.close()
    },
  }
}
