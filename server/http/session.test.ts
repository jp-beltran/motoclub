import { randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildLogoutCookieHeader,
  buildSessionCookieHeader,
  createLoginThrottle,
  createSessionToken,
  guardLoginAttempt,
  hashPin,
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_THROTTLE_DELAY_MS,
  readSessionToken,
  recordLoginFailure,
  recordLoginSuccess,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  verifyPin,
  verifySessionToken,
} from './session'

function scryptHash(pin: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

describe('hashPin / verifyPin', () => {
  it('accepts the correct PIN against a hash it generated', () => {
    const hash = hashPin('1234')
    expect(verifyPin('1234', hash)).toBe(true)
  })

  it('accepts the correct PIN against an independently generated scrypt hash', () => {
    const hash = scryptHash('9876')
    expect(verifyPin('9876', hash)).toBe(true)
  })

  it('rejects a wrong PIN', () => {
    const hash = scryptHash('1234')
    expect(verifyPin('0000', hash)).toBe(false)
  })

  it('rejects a malformed hash without throwing', () => {
    expect(verifyPin('1234', 'not-a-valid-hash')).toBe(false)
    expect(verifyPin('1234', 'scrypt$onlyonepart')).toBe(false)
    expect(verifyPin('1234', '')).toBe(false)
  })

  it('rejects a hash using a different algorithm tag', () => {
    expect(verifyPin('1234', 'bcrypt$abc$def')).toBe(false)
  })
})

describe('createSessionToken / verifySessionToken', () => {
  const secret = 'a-test-secret'

  it('accepts a freshly created token', () => {
    const token = createSessionToken(secret, 1_000_000)
    expect(verifySessionToken(token, secret, 1_000_001)).toBe(true)
  })

  it('rejects a token once its expiry has passed', () => {
    const token = createSessionToken(secret, 1_000_000, 1_000)
    expect(verifySessionToken(token, secret, 1_000_000 + 1_000 + 1)).toBe(false)
  })

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken(secret, 1_000_000)
    expect(verifySessionToken(token, 'a-different-secret', 1_000_001)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const token = createSessionToken(secret, 1_000_000)
    const [, signature] = token.split('.')
    const tampered = `${Buffer.from('9999999999999').toString('base64url')}.${signature}`
    expect(verifySessionToken(tampered, secret, 1_000_001)).toBe(false)
  })

  it('rejects undefined, empty, and malformed tokens', () => {
    expect(verifySessionToken(undefined, secret)).toBe(false)
    expect(verifySessionToken('', secret)).toBe(false)
    expect(verifySessionToken('no-dot-here', secret)).toBe(false)
  })

  it('survives a restart: a token minted before is still valid after, given the same secret and an unexpired clock', () => {
    const mintedBeforeRestart = createSessionToken(secret, 1_000_000)
    // "Restart" here just means a fresh call with no shared in-memory
    // state — the whole point of a stateless token.
    expect(verifySessionToken(mintedBeforeRestart, secret, 1_000_000 + SESSION_TTL_MS - 1)).toBe(
      true,
    )
  })
})

describe('cookie header builders', () => {
  it('builds a Set-Cookie header that is HttpOnly, SameSite=Strict, Path=/, no Secure', () => {
    const header = buildSessionCookieHeader('tok123', 3600)
    expect(header).toContain(`${SESSION_COOKIE_NAME}=tok123`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Strict')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=3600')
    expect(header).not.toContain('Secure')
  })

  it('builds a logout header that clears the cookie immediately', () => {
    const header = buildLogoutCookieHeader()
    expect(header).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(header).toContain('Max-Age=0')
  })
})

describe('readSessionToken', () => {
  it('extracts the session cookie from a Cookie header among others', () => {
    const header = `foo=bar; ${SESSION_COOKIE_NAME}=abc.def; other=1`
    expect(readSessionToken(header)).toBe('abc.def')
  })

  it('returns undefined when the cookie is absent', () => {
    expect(readSessionToken('foo=bar')).toBeUndefined()
    expect(readSessionToken(undefined)).toBeUndefined()
  })
})

describe('login throttle', () => {
  it('does not delay before the failure threshold is reached', async () => {
    const throttle = createLoginThrottle()
    const sleep = vi.fn().mockResolvedValue(undefined)
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD - 1; i += 1) {
      await guardLoginAttempt(throttle, sleep)
      recordLoginFailure(throttle)
    }
    expect(sleep).not.toHaveBeenCalled()
  })

  it('delays once the failure threshold is reached', async () => {
    const throttle = createLoginThrottle()
    const sleep = vi.fn().mockResolvedValue(undefined)
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      recordLoginFailure(throttle)
    }
    await guardLoginAttempt(throttle, sleep)
    expect(sleep).toHaveBeenCalledWith(LOGIN_THROTTLE_DELAY_MS)
  })

  it('resets the failure counter on success, lifting the delay', async () => {
    const throttle = createLoginThrottle()
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) recordLoginFailure(throttle)
    recordLoginSuccess(throttle)
    const sleep = vi.fn().mockResolvedValue(undefined)
    await guardLoginAttempt(throttle, sleep)
    expect(sleep).not.toHaveBeenCalled()
  })
})
