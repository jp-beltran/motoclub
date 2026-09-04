import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BarRepository } from '../src/features/bar/application/bar-repository'
import { LocalBarRepository } from '../src/features/bar/infrastructure/local-bar-repository'
import {
  assertForeignKeysEnabled,
  assertIntegrityOk,
  BootAssertionError,
  loadConfig,
  type ServerConfig,
} from './config'
import { openNodeSqliteDriver, type SqlDriver } from './storage/driver'
import { SqliteStorage } from './storage/sqlite-storage'

/**
 * Read relative to *this file's own runtime location*, deliberately.
 * esbuild collapses every bundled module's `import.meta.url` to the one
 * real output file's path, so a relative lookup like this only resolves
 * correctly when written in the entry point itself (this file, bundled to
 * server/dist/server.mjs) — and because the deployed checkout keeps
 * server/storage/schema.sql at that fixed `../storage/schema.sql` offset
 * from the bundle (see the plan's Fase 1: the whole repo travels together
 * via `git pull`). This file is never run unbundled — its own imports from
 * `src/` are extensionless (tsconfig.app.json's `moduleResolution:
 * "Bundler"`) and Node's ESM loader cannot resolve those without esbuild.
 */
function readSchemaSql(): string {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../storage/schema.sql')
  return readFileSync(schemaPath, 'utf8')
}

/**
 * Opens the database, applies the schema, and runs every boot assertion
 * that needs a live connection. Refuses (throws `BootAssertionError`,
 * caught in `main()`) rather than serving a database that isn't enforcing
 * referential integrity or might be corrupt.
 */
async function openDatabase(config: ServerConfig): Promise<SqlDriver> {
  const driver = await openNodeSqliteDriver(config.dbPath)
  driver.exec(readSchemaSql())
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
 * Only two routes today: a liveness probe and a debugging shortcut for the
 * snapshot ("atalho para depurar com curl" in the plan). The full `/api/rpc`
 * dispatcher, the allowlist of mutating methods, the PIN gate, and static
 * serving are the next task's territory — this handler is intentionally a
 * flat if-chain so those slot in as additional branches without reshaping
 * what already works.
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  repository: BarRepository,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://internal')

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('ok')
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/snapshot') {
    try {
      const snapshot = await repository.getSnapshot()
      sendJson(res, 200, { ok: true, result: snapshot })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      sendJson(res, 500, { ok: false, error: { code: 'internal-error', message } })
    }
    return
  }

  sendJson(res, 404, { ok: false, error: { code: 'not-found' } })
}

function createHttpServer(repository: BarRepository): http.Server {
  return http.createServer((req, res) => {
    handleRequest(req, res, repository).catch((error: unknown) => {
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

async function main(): Promise<void> {
  const config = loadConfig()
  const driver = await openDatabase(config)
  const repository = buildRepository(driver)
  const server = createHttpServer(repository)

  await listen(server, config.port, config.host)
  console.log(`motoclub bar server listening on http://${config.host}:${config.port}`)

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}, shutting down`)
    server.close(() => {
      driver.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  if (error instanceof BootAssertionError) {
    console.error(`Failed to start: ${error.message}`)
    process.exit(error.exitCode)
  }
  console.error('Failed to start:', error)
  process.exit(1)
})
