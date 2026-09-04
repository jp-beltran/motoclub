import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** `scryptSync`'s key length, in bytes. Matches the format the installer's
 * PIN-hash generator produces (see `config.ts`'s `loadEnvConfig` error
 * message): `scrypt$<salt-hex>$<hash-hex>` with a 64-byte derived key. */
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_SALT_LENGTH = 16
const HEX_PATTERN = /^[0-9a-f]+$/i

/**
 * Hashes a PIN into the `BAR_PIN_HASH` wire format. Exposed mainly so
 * tests (and, if ever wanted, a small CLI) do not need to hand-roll the
 * format `scryptSync` + string interpolation the installer's own
 * documented one-liner produces (see `config.ts`).
 */
export function hashPin(pin: string): string {
  const salt = randomBytes(SCRYPT_SALT_LENGTH)
  const hash = scryptSync(pin, salt, SCRYPT_KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * Compares `pin` against `pinHash` (`scrypt$<salt-hex>$<hash-hex>`) using
 * `timingSafeEqual` so a wrong guess cannot be distinguished by response
 * time. `scryptSync` itself runs at the same cost regardless of whether
 * the PIN is right — its runtime depends only on the algorithm's N/r/p
 * parameters and the output length, never on the input value — so nothing
 * here short-circuits before that computation.
 *
 * Never throws: a malformed `BAR_PIN_HASH` (wrong tag, non-hex parts, too
 * few `$`-separated segments) is treated as "does not match", not as a
 * crash that would take the whole request handler down with it.
 */
export function verifyPin(pin: string, pinHash: string): boolean {
  const parts = pinHash.split('$')
  if (parts.length !== 3) return false
  const [tag, saltHex, hashHex] = parts
  if (tag !== 'scrypt') return false
  if (!HEX_PATTERN.test(saltHex) || !HEX_PATTERN.test(hashHex)) return false

  try {
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    if (expected.length === 0) return false
    const actual = scryptSync(pin, salt, expected.length)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * A full shift plus margin. Restarting the service (a crash, a deploy, the
 * daily 4 a.m. backup timer) must not force the operator to re-enter the
 * PIN mid-service — the whole reason the token is stateless
 * (`base64(expiresAt).HMAC-SHA256(secret, expiresAt)`, verified fresh on
 * every request, no server-side session store) rather than an in-memory
 * session map that a restart would wipe.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export const SESSION_COOKIE_NAME = 'motoclub_session'

/**
 * `base64url(expiresAt).base64url(HMAC-SHA256(secret, expiresAt))`.
 * `expiresAt` is an epoch-millisecond integer, carried as the HMAC message
 * so verification never needs anything but the token and the shared
 * secret — no database row, no in-memory map, so a service restart at
 * 4 a.m. does not invalidate a token minted the night before.
 */
export function createSessionToken(
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SESSION_TTL_MS,
): string {
  const expiresAt = String(now + ttlMs)
  const payload = Buffer.from(expiresAt, 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(expiresAt).digest('base64url')
  return `${payload}.${signature}`
}

/** Verifies the HMAC and that `expiresAt` has not passed. Never throws. */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false
  const separatorIndex = token.indexOf('.')
  if (separatorIndex < 0) return false

  const payload = token.slice(0, separatorIndex)
  const signature = token.slice(separatorIndex + 1)
  if (!payload || !signature) return false

  let expiresAtText: string
  try {
    expiresAtText = Buffer.from(payload, 'base64url').toString('utf8')
  } catch {
    return false
  }
  const expiresAt = Number(expiresAtText)
  if (!Number.isFinite(expiresAt)) return false

  const expectedSignature = createHmac('sha256', secret).update(expiresAtText).digest('base64url')
  const actual = Buffer.from(signature, 'utf8')
  const expected = Buffer.from(expectedSignature, 'utf8')
  if (actual.length !== expected.length) return false
  if (!timingSafeEqual(actual, expected)) return false

  return expiresAt > now
}

/**
 * `HttpOnly` (no client script reads it) and `SameSite=Strict` (never sent
 * cross-site). Deliberately **no** `Secure` — the plan's own words: "this
 * is plain HTTP on loopback"; `Secure` would make the cookie invisible to
 * the browser on a plain-HTTP `127.0.0.1` origin, which is the only origin
 * this server ever serves.
 */
export function buildSessionCookieHeader(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`
}

/** `GET /logout`: same attributes, empty value, immediate expiry. */
export function buildLogoutCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
}

/** Finds `motoclub_session` among the `;`-separated pairs of a Cookie header. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined
  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex < 0) continue
    const name = pair.slice(0, separatorIndex).trim()
    if (name === SESSION_COOKIE_NAME) return pair.slice(separatorIndex + 1).trim()
  }
  return undefined
}

/** After this many consecutive failures, `guardLoginAttempt` adds a delay. */
export const LOGIN_FAILURE_THRESHOLD = 5
export const LOGIN_THROTTLE_DELAY_MS = 2000

/**
 * In-memory only, by design (the plan's own words: "contador de falhas com
 * atraso após 5 tentativas") — a single shared PIN on a loopback-only
 * server has no per-client identity to key a smarter throttle on, and a
 * restart clearing this counter is an acceptable, rare cost against the
 * alternative of a persisted lockout an operator could get stuck behind.
 */
export interface LoginThrottle {
  failures: number
}

export function createLoginThrottle(): LoginThrottle {
  return { failures: 0 }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Called before checking a submitted PIN. Once `failures` has reached the
 * threshold, every further attempt pays a fixed delay first — cheap to
 * reason about, and enough to make a naive four-digit brute force take
 * hours instead of seconds, which is the whole point on a shared,
 * unlimited-attempts PIN.
 */
export async function guardLoginAttempt(
  throttle: LoginThrottle,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  if (throttle.failures >= LOGIN_FAILURE_THRESHOLD) {
    await sleep(LOGIN_THROTTLE_DELAY_MS)
  }
}

export function recordLoginFailure(throttle: LoginThrottle): void {
  throttle.failures += 1
}

export function recordLoginSuccess(throttle: LoginThrottle): void {
  throttle.failures = 0
}
