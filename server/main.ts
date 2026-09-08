import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { BarRepository } from '../src/features/bar/application/bar-repository'
import { LocalBarRepository } from '../src/features/bar/infrastructure/local-bar-repository'
import {
  assertForeignKeysEnabled,
  assertIntegrityOk,
  BootAssertionError,
  loadConfig,
  type ServerConfig,
} from './config'
import { createRequestHandler } from './http/router'
import { openNodeSqliteDriver, type SqlDriver } from './storage/driver'
import { SCHEMA_SQL } from './storage/schema'
import { SqliteStorage } from './storage/sqlite-storage'

// Re-exported so `scripts/history.mjs` — which cannot compile TypeScript on
// the target notebook (Fase 0/1: no compiler on that machine, only a Node
// that executes) — can `import` these straight out of the already-built
// `server/dist/server.mjs` instead of reimplementing the SQLite write path
// (and its transactional-history guarantee) a second time in plain JS.
// Importing this bundle for its exports, rather than running it, is safe:
// `isEntryPoint()` (bottom of this file) only calls `main()` when this
// module *is* `process.argv[1]`, which is false for a plain `import`.
export { SqliteStorage } from './storage/sqlite-storage'
export { openNodeSqliteDriver } from './storage/driver'
export { SCHEMA_SQL } from './storage/schema'

/**
 * Pure path arithmetic, split out from `defaultStaticDir` so it can be unit
 * tested with a plain string — no bundling, no filesystem — proving the
 * `'../../dist'` offset is right without needing an esbuild run per test.
 * `bundleDir` is the directory the running file lives in; for the real
 * bundle that is `<repo>/server/dist` (the file is
 * `server/dist/server.mjs`), and `dist/` — the Vite build's output — is
 * two levels up from there, a sibling of `server/`.
 */
export function resolveDistDirFromBundleDir(bundleDir: string): string {
  return join(bundleDir, '..', '..', 'dist')
}

/**
 * The `BAR_STATIC_DIR` default, resolved from *this bundled file's own
 * on-disk location* rather than `process.cwd()`. This only works because
 * `main.ts` always runs bundled to `server/dist/server.mjs` (esbuild
 * collapses every bundled module's `import.meta.url` to that one real
 * path) — `config.ts` cannot assume that for itself, since it also runs
 * *unbundled*, directly under vitest, in `npm run test:server`. That is
 * exactly the assumption that made the original `schema.sql` path lookup
 * (formerly here, now `storage/schema.ts`'s inlined `SCHEMA_SQL`) break
 * the moment `main.ts` itself needed to become importable unbundled (see
 * `bootServer`, below, and `main.test.ts`) — the schema read no longer
 * depends on this trick at all, but `defaultStaticDir` still does, on
 * purpose: only `main()` calls it, and `main()` only ever runs through the
 * `isEntryPoint()` guard at the bottom of this file, i.e. only when this
 * module really is the bundled entry point. No test in this project calls
 * `defaultStaticDir` or `main` directly for that reason; the pure offset
 * arithmetic (`resolveDistDirFromBundleDir`) is what the tests exercise,
 * and the assumption itself is verified empirically by actually running
 * the built bundle from a working directory other than the checkout root
 * (see the task report's manual verification transcript).
 *
 * Without this, the default fell back to `join(process.cwd(), 'dist')`
 * inside `config.ts` — silently correct only when whatever starts the
 * process (a systemd unit's `ExecStart`, a developer's shell) happens to
 * have its working directory set to the checkout root. A systemd user
 * unit that sets `ExecStart` to an absolute path without also setting
 * `WorkingDirectory` defaults to the user's home directory, not the
 * checkout — a real, easy-to-make misconfiguration this removes entirely,
 * because `dist/` is a fixed sibling of `server/` in the checkout no
 * matter where the process was launched from.
 */
function defaultStaticDir(): string {
  return resolveDistDirFromBundleDir(dirname(fileURLToPath(import.meta.url)))
}

/**
 * Opens the database, applies the schema, and runs every boot assertion
 * that needs a live connection. Refuses (throws `BootAssertionError`,
 * caught in `main()`) rather than serving a database that isn't enforcing
 * referential integrity or might be corrupt.
 */
async function openDatabase(config: ServerConfig): Promise<SqlDriver> {
  const driver = await openNodeSqliteDriver(config.dbPath)
  driver.exec(SCHEMA_SQL)
  assertForeignKeysEnabled(driver.get('PRAGMA foreign_keys')?.foreign_keys)
  assertIntegrityOk(driver.get('PRAGMA integrity_check')?.integrity_check)
  return driver
}

/**
 * The transaction engine, unchanged: `LocalBarRepository`'s 689 LOC —
 * clone → mutate → revalidate the whole database → single write — run here
 * exactly as they run in the browser, with `SqliteStorage` as the only new
 * piece underneath.
 */
function buildRepository(driver: SqlDriver): BarRepository {
  return new LocalBarRepository({
    storage: new SqliteStorage(driver),
    nextId: () => randomUUID(),
    now: () => new Date().toISOString(),
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * `GET /healthz`, `POST /api/session`, `GET /logout`, `/assets/*`,
 * `POST /api/rpc`, `GET /api/snapshot`, the SPA fallback (`index.html`
 * behind the PIN gate, `login.html` in front of it), and the JSON/plain
 * 404 split all live in `server/http/router.ts` — see that file for the
 * route table and the reasoning behind its ordering. This function only
 * wires the router's single handler into `node:http` and turns an
 * exception the router itself did not catch into a 500 instead of a
 * hung connection.
 */
function createHttpServer(repository: BarRepository, config: ServerConfig): http.Server {
  const handleRequest = createRequestHandler({
    repository,
    config: {
      pinHash: config.pinHash,
      sessionSecret: config.sessionSecret,
      staticDir: config.staticDir,
    },
  })
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error('Unhandled error while serving a request:', error)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'internal-error' } })
    })
  })
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve) => {
    // Never 0.0.0.0: config.ts already refuses that value structurally, and
    // this call is the other half of the "no network" decision — there is
    // no code path here that can widen it.
    server.listen(port, host, resolve)
  })
}

export interface BootedServer {
  readonly server: http.Server
  readonly driver: SqlDriver
  readonly repository: BarRepository
}

/**
 * Path of the sidecar PID-lock file that marks "a server process currently
 * holds this database open for writes" — sits next to the db file, the
 * same convention as SQLite's own `-wal`/`-shm` sidecars. Read by
 * `checkLockStatus` below and, through the bundle re-export at the top of
 * this file, by `scripts/history.mjs` before it restores a version: a
 * restore is a plain SQLite write, so nothing at the SQLite layer stops it
 * from racing a live server's own writes — this file is what lets the CLI
 * refuse that race instead of silently risking a lost update.
 */
export function lockFilePath(dbPath: string): string {
  return `${dbPath}.lock`
}

function writeLockFile(dbPath: string): void {
  const contents = { pid: process.pid, startedAt: new Date().toISOString() }
  writeFileSync(lockFilePath(dbPath), JSON.stringify(contents), 'utf8')
}

function removeLockFile(dbPath: string): void {
  try {
    unlinkSync(lockFilePath(dbPath))
  } catch {
    // Already gone (a second call, or a boot that never got this far) —
    // shutdown must not fail over a lock file that was never there.
  }
}

/** True iff the OS reports a process with this pid still exists. Used to
 * tell a live lock apart from one a crash (SIGKILL, power loss) left
 * behind without running `removeLockFile` — see `checkLockStatus`. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export interface LockStatus {
  readonly running: boolean
  readonly pid?: number
  readonly stale?: boolean
}

/**
 * Whether a server process currently appears to hold `dbPath` open for
 * writes. A missing or unparseable lock file, and a lock whose pid is no
 * longer alive, are both reported as `running: false` — the pid-dead case
 * is deliberately forgiving (a hard crash that skipped `removeLockFile`
 * must not permanently block recovery) but is marked `stale: true` so a
 * caller (`scripts/history.mjs`) can still tell an operator what it saw
 * instead of silently proceeding as if the file had never existed.
 */
export function checkLockStatus(dbPath: string): LockStatus {
  let raw: string
  try {
    raw = readFileSync(lockFilePath(dbPath), 'utf8')
  } catch {
    return { running: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { running: false }
  }
  const pid = (parsed as { pid?: unknown }).pid
  if (typeof pid !== 'number') return { running: false }
  return isProcessAlive(pid) ? { running: true, pid } : { running: false, pid, stale: true }
}

/**
 * Everything short of process-level wiring (signal handlers, the final
 * console log, `process.exit` on failure): opens the database, runs the
 * connection-dependent boot assertions, builds the repository, creates the
 * HTTP server, and starts listening. Exported so a test can drive a real
 * server end to end — an ephemeral port (`config.port = 0`), a temp-file
 * database — without importing this module's own `process.env`/
 * `process.exit`-touching `main()`.
 *
 * `writeLockFile` runs last, only once `listen()` has actually succeeded —
 * a failed boot (e.g. the port is already in use) must not leave a lock
 * file behind for a server that never really started.
 */
export async function bootServer(config: ServerConfig): Promise<BootedServer> {
  const driver = await openDatabase(config)
  const repository = buildRepository(driver)
  const server = createHttpServer(repository, config)
  await listen(server, config.port, config.host)
  writeLockFile(config.dbPath)
  return { server, driver, repository }
}

/**
 * The actual shutdown sequence, independent of what triggers it (a real
 * SIGINT/SIGTERM in production, a direct call from a test). Relies on
 * `http.Server#close`'s own contract to protect an in-flight request:
 * it immediately stops the server from accepting *new* connections but
 * does not touch connections already in progress, and its callback fires
 * only once every one of those has finished — which is why `driver.close()`
 * runs inside that callback, never before it. Closing the SQLite
 * connection out from under a request still awaiting its own
 * `driver.get`/`run` would surface as a confusing "database is closed"
 * error instead of the request finishing normally.
 *
 * `closeIdleConnections()` is the other half of this, and was only added
 * after the first version of this function measured a real, reproducible
 * multi-second stall in its own test: `server.close()`'s callback does not
 * fire just because every *request* has finished — it waits for every
 * *connection* to close, and a keep-alive HTTP/1.1 connection (the
 * default on both ends) sits open, idle, long after its last response was
 * sent, until a timeout on either side eventually tears it down. On a real
 * restart that means every browser tab left open against the app adds its
 * own idle-timeout's worth of delay to `systemctl restart motoclub`.
 * `closeIdleConnections()` (Node >= 18.2, so always available on this
 * server's >= 22.5 floor) destroys only sockets with no request currently
 * in flight — a genuinely in-flight one is untouched and still finishes
 * normally under `close()`'s own contract. A single call at the top only
 * catches connections *already* idle the instant shutdown begins, though:
 * one that is mid-request right now becomes idle moments later, once its
 * response finishes, and nothing then nudges it closed — so this polls,
 * repeating the call every 50ms until `close()`'s callback fires, to catch
 * exactly that connection as soon as it goes idle instead of waiting out
 * whatever timeout the client or OS eventually applies.
 *
 * `timeoutMs` bounds all of the above: a request that never resolves (a
 * bug, a downstream call that hangs) is still "in flight" as far as
 * `close()` is concerned forever, and without a limit this promise — and
 * therefore `systemctl restart motoclub` — would simply never return,
 * until systemd's own SIGKILL timeout (not this code's to configure)
 * eventually ends it uncleanly. After `timeoutMs`, `closeAllConnections()`
 * — unlike `closeIdleConnections()`, this forcibly destroys a connection
 * mid-request too — runs, and `finish()` is called directly right after it
 * rather than only trusting `close()`'s own callback to react to the
 * now-empty connection set on its own schedule. A `settled` guard makes
 * the two paths (the graceful one and this forced one) race safely
 * without ever closing the driver twice, whichever gets there first.
 */
export const SHUTDOWN_TIMEOUT_MS = 5_000

export function shutdown(
  server: http.Server,
  driver: SqlDriver,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearInterval(pollIdleConnections)
      clearTimeout(forceCloseTimer)
      driver.close()
      resolve()
    }

    const pollIdleConnections = setInterval(() => server.closeIdleConnections(), 50)
    const forceCloseTimer = setTimeout(() => {
      server.closeAllConnections()
      finish()
    }, timeoutMs)

    server.close(finish)
    server.closeIdleConnections()
  })
}

/** Wires `shutdown` to real OS signals and exits the process once it
 * completes. Kept separate from `shutdown` itself so a test can exercise
 * the shutdown *sequence* without registering real `process.on` listeners
 * or calling the real `process.exit` — both of which would affect the
 * test runner's own process, not just the server under test.
 *
 * `removeLockFile` runs here rather than inside `shutdown()` itself for the
 * same reason: `shutdown()` is deliberately process-agnostic (a test calls
 * it directly, with no lock file involved), while *this* function is only
 * ever reached on a real process shutdown — the one case where the lock
 * file genuinely needs to disappear so the next boot, or a `restore` run
 * while this process is down, sees an honestly empty lock. */
export function installShutdownHandlers(server: http.Server, driver: SqlDriver, dbPath: string): void {
  let shuttingDown = false
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}, shutting down`)
    shutdown(server, driver).then(() => {
      removeLockFile(dbPath)
      process.exit(0)
    })
  }
  process.on('SIGINT', () => handle('SIGINT'))
  process.on('SIGTERM', () => handle('SIGTERM'))
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, { staticDir: defaultStaticDir() })
  const { server, driver } = await bootServer(config)
  console.log(`motoclub bar server listening on http://${config.host}:${config.port}`)
  installShutdownHandlers(server, driver, config.dbPath)
}

/**
 * Guards the auto-run below so importing this module (as
 * `server/main.test.ts` does, to exercise `bootServer`/`shutdown`) never
 * boots a real server against real env vars — only running this file
 * directly (bundled, as `node server/dist/server.mjs`) does. Comparing
 * `import.meta.url` to the entry script's path (there is no CommonJS
 * `require.main === module` under ESM) is the standard way to express
 * "am I the entry point" here; it works the same whether the file is
 * bundled or not, so it does not depend on the bundling assumption the
 * two functions above do.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    if (error instanceof BootAssertionError) {
      console.error(`Failed to start: ${error.message}`)
      process.exit(error.exitCode)
    }
    console.error('Failed to start:', error)
    process.exit(1)
  })
}
