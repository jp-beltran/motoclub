import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashPin } from './http/session'
import { bootServer, resolveDistDirFromBundleDir, shutdown, type BootedServer } from './main'

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
})
