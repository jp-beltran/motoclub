import { randomUUID } from 'node:crypto'
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
 * Everything short of process-level wiring (signal handlers, the final
 * console log, `process.exit` on failure): opens the database, runs the
 * connection-dependent boot assertions, builds the repository, creates the
 * HTTP server, and starts listening. Exported so a test can drive a real
 * server end to end — an ephemeral port (`config.port = 0`), a temp-file
 * database — without importing this module's own `process.env`/
 * `process.exit`-touching `main()`.
 */
export async function bootServer(config: ServerConfig): Promise<BootedServer> {
  const driver = await openDatabase(config)
  const repository = buildRepository(driver)
  const server = createHttpServer(repository, config)
  await listen(server, config.port, config.host)
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
 */
export function shutdown(server: http.Server, driver: SqlDriver): Promise<void> {
  return new Promise((resolve) => {
    const pollIdleConnections = setInterval(() => server.closeIdleConnections(), 50)
    server.close(() => {
      clearInterval(pollIdleConnections)
      driver.close()
      resolve()
    })
    server.closeIdleConnections()
  })
}

/** Wires `shutdown` to real OS signals and exits the process once it
 * completes. Kept separate from `shutdown` itself so a test can exercise
 * the shutdown *sequence* without registering real `process.on` listeners
 * or calling the real `process.exit` — both of which would affect the
 * test runner's own process, not just the server under test. */
export function installShutdownHandlers(server: http.Server, driver: SqlDriver): void {
  let shuttingDown = false
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}, shutting down`)
    shutdown(server, driver).then(() => process.exit(0))
  }
  process.on('SIGINT', () => handle('SIGINT'))
  process.on('SIGTERM', () => handle('SIGTERM'))
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, { staticDir: defaultStaticDir() })
  const { server, driver } = await bootServer(config)
  console.log(`motoclub bar server listening on http://${config.host}:${config.port}`)
  installShutdownHandlers(server, driver)
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
