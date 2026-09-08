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
 *
 * SHARED CONTRACT, DUPLICATED ON PURPOSE: `playwright.config.ts` and
 * `scripts/lib/scrypt-hash.mjs` reimplement this same algorithm rather
 * than importing it — the first so the e2e config's TypeScript project
 * never has to resolve `server/`'s module graph just to boot a test
 * server, the second so the installer can hash a PIN on a machine that
 * has no build step at all. Nothing but these comments keeps the three
 * from drifting: if you change `SCRYPT_SALT_LENGTH`,
 * `SCRYPT_KEY_LENGTH`, or the `scrypt$<salt>$<hash>` layout here, change
 * it in both of those too, or `verifyPin` starts rejecting a PIN the
 * installer just accepted. The format is fixed by the shared backend
 * contract (`.superpowers/sdd/prototipo-bar-ui/backend-contract.md`).
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
/** The delay grows by this much per failure past the threshold. */
export const LOGIN_DELAY_STEP_MS = 500
/** ...up to this ceiling, so a very stale counter cannot produce an
 * effectively unbounded (and therefore self-defeating, "the operator is
 * now locked out too") wait. */
export const LOGIN_MAX_DELAY_MS = 30_000

/**
 * In-memory only, by design (the plan's own words: "contador de falhas com
 * atraso após 5 tentativas") — a single shared PIN on a loopback-only
 * server has no per-client identity to key a smarter throttle on, and a
 * restart clearing this counter is an acceptable, rare cost against the
 * alternative of a persisted lockout an operator could get stuck behind.
 *
 * `queue` is what makes the delay actually cost an attacker something:
 * without it, N concurrent guesses each independently `await
 * sleep(delay)` and all finish together after one delay's wall-clock
 * time, so N attempts cost the same as one — the fixed-delay version of
 * this function measured exactly that. Chaining every call onto `queue`
 * forces attempts through one at a time, so throughput is bounded by
 * `1 / delay`, not by how many requests the caller can fire in parallel.
 */
export interface LoginThrottle {
  failures: number
  queue: Promise<void>
}

export function createLoginThrottle(): LoginThrottle {
  return { failures: 0, queue: Promise.resolve() }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Called before checking a submitted PIN. Below the threshold there is no
 * queueing and no delay at all — `scryptSync`'s own cost (tens to a few
 * hundred milliseconds on this hardware; slower still on the target
 * notebook's APU) is what protects the fast path, and the plan is explicit
 * that on a loopback, shared-PIN server this whole mechanism is a screen
 * lock, not a security boundary.
 *
 * Once `failures` reaches the threshold, every further attempt is
 * serialized behind `throttle.queue` (see the interface doc for why that
 * matters) and pays a delay that grows with the failure count
 * (`LOGIN_DELAY_STEP_MS` per failure, capped at `LOGIN_MAX_DELAY_MS`) —
 * together, a sustained attack really does get slower the longer it runs,
 * which a flat per-call delay alone does not deliver under concurrency.
 */
export function guardLoginAttempt(
  throttle: LoginThrottle,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  const attempt = throttle.queue.then(async () => {
    if (throttle.failures >= LOGIN_FAILURE_THRESHOLD) {
      const delay = Math.min(throttle.failures * LOGIN_DELAY_STEP_MS, LOGIN_MAX_DELAY_MS)
      await sleep(delay)
    }
  })
  // Chain the next call onto this one regardless of outcome, so a
  // rejected `sleep` (there is no reason for the real one to reject, but
  // a test double could) cannot wedge every attempt behind it forever.
  throttle.queue = attempt.catch(() => {})
  return attempt
}

export function recordLoginFailure(throttle: LoginThrottle): void {
  throttle.failures += 1
}

export function recordLoginSuccess(throttle: LoginThrottle): void {
  throttle.failures = 0
}
