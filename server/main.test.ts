import { execFileSync, fork, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { hashPin } from './http/session'
import {
  bootServer,
  checkLockStatus,
  lockFilePath,
  resolveDistDirFromBundleDir,
  shutdown,
  type BootedServer,
} from './main'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const PIN = '4242'
const PIN_HASH = hashPin(PIN)
const SESSION_SECRET = 'main-test-session-secret'

let workDir: string | undefined
let booted: BootedServer | undefined

afterEach(async () => {
  if (booted) {
    await shutdown(booted.server, booted.driver)
    booted = undefined
  }
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true })
    workDir = undefined
  }
})

async function startBootedServer(): Promise<{ baseUrl: string; instance: BootedServer }> {
  workDir = mkdtempSync(join(tmpdir(), 'main-test-'))
  const dbPath = join(workDir, 'bar.sqlite3')
  const staticDir = join(workDir, 'dist')
  mkdirSync(staticDir, { recursive: true })
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>App</title>')

  booted = await bootServer({
    dbPath,
    pinHash: PIN_HASH,
    sessionSecret: SESSION_SECRET,
    port: 0,
    host: '127.0.0.1',
    staticDir,
  })
  const address = booted.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { baseUrl: `http://127.0.0.1:${port}`, instance: booted }
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('login did not set a cookie')
  return cookie
}

describe('resolveDistDirFromBundleDir', () => {
  it('resolves the built frontend as a sibling of server/, two levels up from server/dist', () => {
    expect(resolveDistDirFromBundleDir('/opt/motoclub/server/dist')).toBe('/opt/motoclub/dist')
  })

  it('is agnostic to a trailing slash on the bundle directory', () => {
    expect(resolveDistDirFromBundleDir('/opt/motoclub/server/dist/')).toBe('/opt/motoclub/dist')
  })
})

describe('bootServer — the routes the previous slice shipped keep working as routing grows', () => {
  it('GET /healthz responds "ok", ungated', async () => {
    const { baseUrl } = await startBootedServer()
    const response = await fetch(`${baseUrl}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('GET /api/snapshot still responds, once authenticated', async () => {
    const { baseUrl } = await startBootedServer()
    const cookie = await login(baseUrl)
    const response = await fetch(`${baseUrl}/api/snapshot`, { headers: { Cookie: cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; result: unknown }
    expect(body.ok).toBe(true)
    expect(body.result).toHaveProperty('consumers')
  })

  it('an unknown route under /api is a JSON 404', async () => {
    const { baseUrl } = await startBootedServer()
    const response = await fetch(`${baseUrl}/api/this-does-not-exist`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(await response.json()).toEqual({ ok: false, error: { code: 'not-found' } })
  })

  it('an unknown route outside /api is a plain-text 404, not HTML', async () => {
    const { baseUrl } = await startBootedServer()
    const response = await fetch(`${baseUrl}/this-does-not-exist.png`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/text\/plain/)
  })
})

describe('shutdown', () => {
  it('lets an in-flight request finish before closing the database driver', async () => {
    const { baseUrl, instance } = await startBootedServer()
    const cookie = await login(baseUrl)

    // Make the next getSnapshot() call hang until this test releases it,
    // simulating "a request is still in flight" without needing real
    // network-level timing tricks. `requestStarted` fires the instant the
    // handler has actually reached `getSnapshot` — waiting on it (instead
    // of an arbitrary `setTimeout`) is what guarantees the request is
    // genuinely in flight (accepted, and blocked inside the handler)
    // before `shutdown()` is called; without that guarantee, `fetch()`'s
    // connection might not even have reached the server yet, and
    // `server.close()` would have nothing "in flight" to protect.
    let requestStarted: () => void = () => {}
    const requestStartedPromise = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    let releaseInFlightRequest: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseInFlightRequest = resolve
    })
    const originalGetSnapshot = instance.repository.getSnapshot.bind(instance.repository)
    instance.repository.getSnapshot = async () => {
      requestStarted()
      await gate
      return originalGetSnapshot()
    }

    const inFlight = fetch(`${baseUrl}/api/snapshot`, { headers: { Cookie: cookie } })
    await requestStartedPromise

    let shutdownFinished = false
    const shutdownPromise = shutdown(instance.server, instance.driver).then(() => {
      shutdownFinished = true
    })
    // Shutdown has been kicked off for real now — `afterEach` must not
    // also call `shutdown()` on this instance (that would `driver.close()`
    // a second time and throw), regardless of whether an assertion below
    // this point fails.
    booted = undefined

    // Give the event loop a couple of turns so `shutdown`'s `server.close()`
    // call has actually run before we assert it hasn't finished yet.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(shutdownFinished).toBe(false)

    releaseInFlightRequest()
    const response = await inFlight
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    // Regression guard for the real bug this test caught while it was
    // being written: the underlying HTTP/1.1 keep-alive connection stays
    // open (idle) after the response above, and without
    // `closeIdleConnections()` being polled inside `shutdown()`,
    // `server.close()`'s callback did not fire until that idle connection
    // timed out on its own — multiple seconds, observed directly. A
    // restart of the real service must not inherit that stall for every
    // browser tab left open against it.
    const beforeAwait = Date.now()
    await shutdownPromise
    expect(Date.now() - beforeAwait).toBeLessThan(1000)
    expect(shutdownFinished).toBe(true)

    // The driver is only closed once shutdown() resolves — confirm it
    // really is closed now, proving driver.close() ran after, not before,
    // the in-flight request completed.
    expect(() => instance.driver.get('SELECT 1 as one')).toThrow()
  })

  it('has an upper bound: resolves within its timeout even if a request never finishes', async () => {
    const { baseUrl, instance } = await startBootedServer()
    const cookie = await login(baseUrl)

    let requestStarted: () => void = () => {}
    const requestStartedPromise = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    // Deliberately never resolves — a handler stuck forever (a bug, a
    // hung downstream call) must not hold `systemctl restart motoclub`
    // hostage until systemd's own SIGKILL timeout, whatever that happens
    // to be configured as.
    instance.repository.getSnapshot = async () => {
      requestStarted()
      return new Promise<never>(() => {})
    }

    const hangingRequest = fetch(`${baseUrl}/api/snapshot`, {
      headers: { Cookie: cookie },
    }).catch(() => undefined)
    await requestStartedPromise

    const startedAt = Date.now()
    await shutdown(instance.server, instance.driver, 100)
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(() => instance.driver.get('SELECT 1 as one')).toThrow()

    booted = undefined
    void hangingRequest
  })
})

describe('lock file — marks "a server is holding this database open for writes"', () => {
  it('lockFilePath names a sidecar next to the db file, same convention as -wal/-shm', () => {
    expect(lockFilePath('/home/x/.local/share/motoclub/bar.sqlite3')).toBe(
      '/home/x/.local/share/motoclub/bar.sqlite3.lock',
    )
  })

  it('checkLockStatus reports "not running" when no lock file exists', () => {
    workDir = mkdtempSync(join(tmpdir(), 'lock-status-test-'))
    const dbPath = join(workDir, 'bar.sqlite3')

    expect(checkLockStatus(dbPath)).toEqual({ running: false })
  })

  it('bootServer writes a lock file naming this process as the one holding the database open', async () => {
    const { instance } = await startBootedServer()
    void instance

    const dbPath = join(workDir as string, 'bar.sqlite3')
    expect(existsSync(lockFilePath(dbPath))).toBe(true)
    expect(checkLockStatus(dbPath)).toEqual({ running: true, pid: process.pid })
  })

  it('checkLockStatus reports a stale lock (dead pid) as not running, but flags it as stale', () => {
    workDir = mkdtempSync(join(tmpdir(), 'lock-status-test-'))
    const dbPath = join(workDir, 'bar.sqlite3')
    // A real short-lived process, so its pid is guaranteed to belong to
    // nothing by the time this assertion runs — no guessing at an
    // arbitrary "probably unused" pid number.
    const dead = spawnSync(process.execPath, ['-e', ''])
    const deadPid = dead.pid
    if (!deadPid) throw new Error('failed to spawn a short-lived process for this test')
    writeFileSync(lockFilePath(dbPath), JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }), 'utf8')

    expect(checkLockStatus(dbPath)).toEqual({ running: false, pid: deadPid, stale: true })
  })

  it('checkLockStatus tolerates a corrupt/unreadable lock file by reporting "not running"', () => {
    workDir = mkdtempSync(join(tmpdir(), 'lock-status-test-'))
    const dbPath = join(workDir, 'bar.sqlite3')
    writeFileSync(lockFilePath(dbPath), 'not json at all', 'utf8')

    expect(checkLockStatus(dbPath)).toEqual({ running: false })
  })
})

/**
 * `shutdown()` above is well covered directly, but the actual wiring —
 * `process.on('SIGTERM', ...) -> shutdown() -> process.exit(0)` in
 * `installShutdownHandlers` — is not exercised by any of those tests,
 * since calling it for real would register a signal handler on *this*
 * process (the test runner), not just "the server under test". The only
 * way to drive the real handler with a real signal, without touching the
 * runner's own process, is to run it in a genuinely separate process: this
 * forks the actual built bundle (not `server/main.ts` directly — its
 * `src/` imports are extensionless and Node's ESM loader cannot resolve
 * them unbundled, the same reason `readSchemaSql`/`SCHEMA_SQL` exist) and
 * sends it a real `SIGTERM`.
 */
describe('installShutdownHandlers (real SIGTERM against the built bundle)', () => {
  it('exits with code 0 only after logging the shutdown message', async () => {
    // Build fresh so this test does not depend on some earlier `npm run
    // build:server` having already been run, or on a stale artifact.
    execFileSync(
      'npx',
      [
        'esbuild',
        'server/main.ts',
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--target=node22',
        '--outfile=server/dist/server.mjs',
      ],
      { cwd: REPO_ROOT, stdio: 'ignore' },
    )

    workDir = mkdtempSync(join(tmpdir(), 'main-fork-test-'))
    const dbPath = join(workDir, 'bar.sqlite3')
    const staticDir = join(workDir, 'dist')
    mkdirSync(staticDir, { recursive: true })
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>App</title>')

    // `BAR_PORT=0` (the usual "let the OS pick an ephemeral port" trick
    // this suite otherwise relies on) is refused by `config.ts`'s own
    // validation, on purpose — it is not a real TCP port. This test never
    // needs to actually connect to the child over HTTP, so a fixed port
    // picked at random from the high range is enough; retried with a
    // fresh port on the rare chance of a real collision, so this test's
    // own flakiness budget is not "however often two random ports in a
    // 10000-wide range happen to collide."
    const { child, stdoutRef } = await forkServerAndWaitForListening({
      BAR_DB_PATH: dbPath,
      BAR_PIN_HASH: PIN_HASH,
      BAR_SESSION_SECRET: SESSION_SECRET,
      BAR_HOST: '127.0.0.1',
      BAR_STATIC_DIR: staticDir,
      TZ: 'America/Sao_Paulo',
    })

    // The lock file is what scripts/history.mjs checks before restoring a
    // version — proving it names *this real child process*, alive, is what
    // makes that refusal trustworthy rather than a check against a fake.
    expect(existsSync(lockFilePath(dbPath))).toBe(true)
    expect(checkLockStatus(dbPath)).toEqual({ running: true, pid: child.pid })

    const exitPromise = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code))
    })

    child.kill('SIGTERM')
    const code = await exitPromise

    expect(code).toBe(0)
    expect(stdoutRef.value).toContain('Received SIGTERM, shutting down')
    // A graceful shutdown removes the lock — the next thing to run against
    // this database (another `motoclub` start, or scripts/history.mjs) must
    // not see a live-looking lock for a process that just exited cleanly.
    expect(existsSync(lockFilePath(dbPath))).toBe(false)
  }, 15000)
})

interface ForkedServer {
  readonly child: ReturnType<typeof fork>
  readonly stdoutRef: { value: string }
}

/** Forks `server/dist/server.mjs` with a randomly-chosen port, retrying
 * with a fresh port if the child exits before logging "listening on"
 * (the observable symptom of a port collision, among other early-exit
 * causes) — up to a few attempts, so this stays a real, rare-flake-free
 * end-to-end check rather than something that occasionally fails for a
 * reason unrelated to what it is testing. */
async function forkServerAndWaitForListening(
  env: Record<string, string>,
  attemptsLeft = 3,
): Promise<ForkedServer> {
  const port = 40000 + Math.floor(Math.random() * 10000)
  const child = fork(join(REPO_ROOT, 'server/dist/server.mjs'), [], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env, BAR_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  const stdoutRef = { value: '' }
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutRef.value += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const startupTimer = setTimeout(
        () => reject(new Error(`server did not start in time; stdout: ${stdoutRef.value}\nstderr: ${stderr}`)),
        8000,
      )
      const onData = (chunk: Buffer): void => {
        if (chunk.toString().includes('listening on')) {
          clearTimeout(startupTimer)
          child.stdout?.off('data', onData)
          resolve()
        }
      }
      child.stdout?.on('data', onData)
      child.once('error', reject)
      child.once('exit', (code) =>
        reject(
          new Error(
            `child exited early with code ${code} on port ${port}\nstdout: ${stdoutRef.value}\nstderr: ${stderr}`,
          ),
        ),
      )
    })
  } catch (error) {
    if (attemptsLeft <= 1) throw error
    return forkServerAndWaitForListening(env, attemptsLeft - 1)
  }

  return { child, stdoutRef }
}
