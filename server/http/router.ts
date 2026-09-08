import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BarRepository } from '../../src/features/bar/application/bar-repository'
import { invokeRpcMethod, statusForRpcError } from './rpc'
import {
  buildLogoutCookieHeader,
  buildSessionCookieHeader,
  createLoginThrottle,
  createSessionToken,
  guardLoginAttempt,
  type LoginThrottle,
  readSessionToken,
  recordLoginFailure,
  recordLoginSuccess,
  SESSION_TTL_MS,
  verifyPin,
  verifySessionToken,
} from './session'
import {
  hasDottedLastSegment,
  isApiPath,
  isAssetPath,
  sendPlainNotFound,
  serveAppShell,
  serveRootStaticFile,
  serveStaticAsset,
} from './static'

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** The router only ever needs these three fields off `ServerConfig` — kept
 * as a narrow `Pick` so tests can build one without going through
 * `config.ts`'s env parsing. */
export interface RouterConfig {
  readonly pinHash: string
  readonly sessionSecret: string
  readonly staticDir: string
}

export interface RouterDependencies {
  readonly repository: BarRepository
  readonly config: RouterConfig
  /** Injectable so tests can prove the throttle fires without actually
   * waiting out its (escalating) delay; defaults to a real `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>
  readonly throttle?: LoginThrottle
}

const MAX_BODY_BYTES = 1_000_000

type BodyResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

/** Reads and JSON-parses the request body, capped at `MAX_BODY_BYTES`.
 * Never throws — a missing, oversized, or unparseable body all resolve to
 * `{ ok: false }`, which every caller turns into a 400. */
async function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      total += buffer.length
      if (total > MAX_BODY_BYTES) return { ok: false }
      chunks.push(buffer)
    }
  } catch {
    return { ok: false }
  }
  if (chunks.length === 0) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendUnauthorized(res: ServerResponse): void {
  sendJson(res, 401, { ok: false, error: { code: 'unauthorized' } })
}

function sendBadRequest(res: ServerResponse): void {
  sendJson(res, 400, { ok: false, error: { code: 'bad-request' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuthenticated(req: IncomingMessage, sessionSecret: string): boolean {
  return verifySessionToken(readSessionToken(req.headers.cookie), sessionSecret)
}

/**
 * `POST /api/session { pin }`. Throttled by `guardLoginAttempt` (a delay
 * once `failures` crosses the threshold — see `session.ts`), then a
 * `timingSafeEqual` comparison against `BAR_PIN_HASH`. On success, sets the
 * stateless HMAC cookie and resets the throttle; on failure, counts it and
 * answers 401 without revealing anything the taxonomy would (this is not a
 * `BarError`, so it is not in `BAR_ERROR_STATUS` — it is this HTTP layer's
 * own `invalid-pin` code).
 */
async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  config: RouterConfig,
  throttle: LoginThrottle,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  await guardLoginAttempt(throttle, sleep)

  const body = await readJsonBody(req)
  if (!body.ok || !isRecord(body.value) || typeof body.value.pin !== 'string') {
    sendBadRequest(res)
    return
  }

  if (!verifyPin(body.value.pin, config.pinHash)) {
    recordLoginFailure(throttle)
    sendJson(res, 401, { ok: false, error: { code: 'invalid-pin' } })
    return
  }

  recordLoginSuccess(throttle)
  const token = createSessionToken(config.sessionSecret)
  res.setHeader('Set-Cookie', buildSessionCookieHeader(token, Math.floor(SESSION_TTL_MS / 1000)))
  sendJson(res, 200, { ok: true })
}

/**
 * `POST /api/rpc { method, args }`. Requires an authenticated session
 * (checked by the caller before this runs). Validates the request shape
 * (`method` a string, `args` an array or absent) before ever touching
 * `invokeRpcMethod`'s allowlist — a malformed body is a 400, not a 400
 * dressed up as an unknown-method 400 from the allowlist layer.
 */
async function handleRpc(
  req: IncomingMessage,
  res: ServerResponse,
  repository: BarRepository,
): Promise<void> {
  const body = await readJsonBody(req)
  if (!body.ok || !isRecord(body.value) || typeof body.value.method !== 'string') {
    sendBadRequest(res)
    return
  }
  const argsValue = 'args' in body.value ? body.value.args : []
  if (!Array.isArray(argsValue)) {
    sendBadRequest(res)
    return
  }

  try {
    const result = await invokeRpcMethod(repository, body.value.method, argsValue)
    sendJson(res, 200, { ok: true, result })
  } catch (error) {
    const { status, code } = statusForRpcError(error)
    sendJson(res, status, { ok: false, error: { code } })
  }
}

/** `GET /api/snapshot` — the plain alias kept for debugging with curl (see
 * the plan). Requires the same session cookie as `/api/rpc`: the gate
 * lives entirely on the server, and this is as much a read of the whole
 * database as any RPC call, so it gets no exemption. */
async function handleSnapshot(res: ServerResponse, repository: BarRepository): Promise<void> {
  try {
    const result = await repository.getSnapshot()
    sendJson(res, 200, { ok: true, result })
  } catch (error) {
    const { status, code } = statusForRpcError(error)
    sendJson(res, status, { ok: false, error: { code } })
  }
}

/**
 * Builds the single request handler `main.ts` hands to `http.createServer`.
 *
 * Route order matters: `/healthz`, `/api/session`, and `/logout` are
 * checked first and are always ungated; `/assets/*` next, also ungated;
 * then the two authenticated JSON endpoints; then the SPA fallback for any
 * other GET without a dotted last segment (index.html behind the gate,
 * login.html in front of it); everything left over is a 404 — JSON under
 * `/api`, plain text elsewhere, per the plan's explicit "a JSON API
 * returning an HTML error page is its own bug."
 */
export function createRequestHandler(deps: RouterDependencies): RequestHandler {
  const throttle = deps.throttle ?? createLoginThrottle()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const { repository, config } = deps

  return async function handleRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://internal')
    const pathname = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('ok')
      return
    }

    if (method === 'POST' && pathname === '/api/session') {
      await handleLogin(req, res, config, throttle, sleep)
      return
    }

    if (method === 'GET' && pathname === '/logout') {
      res.writeHead(302, { 'Set-Cookie': buildLogoutCookieHeader(), Location: '/' })
      res.end()
      return
    }

    if (method === 'GET' && isAssetPath(pathname)) {
      const served = await serveStaticAsset(res, config.staticDir, pathname)
      if (!served) sendPlainNotFound(res)
      return
    }

    if (method === 'POST' && pathname === '/api/rpc') {
      if (!isAuthenticated(req, config.sessionSecret)) {
        sendUnauthorized(res)
        return
      }
      await handleRpc(req, res, repository)
      return
    }

    if (method === 'GET' && pathname === '/api/snapshot') {
      if (!isAuthenticated(req, config.sessionSecret)) {
        sendUnauthorized(res)
        return
      }
      await handleSnapshot(res, repository)
      return
    }

    // Any other GET outside /api: a dotted last segment is a real file
    // request — try it against the root of `staticDir` (favicon.ico,
    // robots.txt, a manifest; `/assets/*` was already handled above, with
    // its own caching, so this never re-serves a hashed bundle file) —
    // and only fall through to the SPA shell when there is no dot at all,
    // i.e. this really does look like one of the eight app routes.
    if (method === 'GET' && !isApiPath(pathname)) {
      if (hasDottedLastSegment(pathname)) {
        const served = await serveRootStaticFile(res, config.staticDir, pathname)
        if (!served) sendPlainNotFound(res)
        return
      }
      await serveAppShell(res, config.staticDir, isAuthenticated(req, config.sessionSecret))
      return
    }

    if (isApiPath(pathname)) {
      sendJson(res, 404, { ok: false, error: { code: 'not-found' } })
      return
    }
    sendPlainNotFound(res)
  }
}
