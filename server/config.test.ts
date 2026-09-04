import { describe, expect, it } from 'vitest'
import {
  assertForeignKeysEnabled,
  assertIntegrityOk,
  assertSupportedNodeVersion,
  assertTimezone,
  BootAssertionError,
  isSupportedNodeVersion,
  loadEnvConfig,
  REQUIRED_TIMEZONE,
} from './config'

describe('isSupportedNodeVersion', () => {
  it('accepts the exact minimum version', () => {
    expect(isSupportedNodeVersion('v22.5.0')).toBe(true)
  })

  it('accepts a newer major version', () => {
    expect(isSupportedNodeVersion('v24.12.0')).toBe(true)
  })

  it('accepts a newer minor version on the minimum major', () => {
    expect(isSupportedNodeVersion('v22.10.0')).toBe(true)
  })

  it('rejects an older major version', () => {
    expect(isSupportedNodeVersion('v20.11.0')).toBe(false)
  })

  it('rejects an older minor version on the minimum major', () => {
    expect(isSupportedNodeVersion('v22.4.9')).toBe(false)
  })
})

describe('assertSupportedNodeVersion', () => {
  it('throws a BootAssertionError with exit code 2 and an actionable message on an old Node', () => {
    try {
      assertSupportedNodeVersion('v18.20.0')
      expect.unreachable('expected assertSupportedNodeVersion to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).exitCode).toBe(2)
      expect((error as BootAssertionError).message).toMatch(/22\.5\.0/)
      expect((error as BootAssertionError).message).toMatch(/v18\.20\.0/)
    }
  })

  it('does not throw on the current, supported Node', () => {
    expect(() => assertSupportedNodeVersion(process.version)).not.toThrow()
  })
})

describe('assertTimezone', () => {
  it('passes for America/Sao_Paulo', () => {
    expect(() => assertTimezone(REQUIRED_TIMEZONE)).not.toThrow()
  })

  it('throws exit code 3 for any other zone, naming both zones in the message', () => {
    try {
      assertTimezone('UTC')
      expect.unreachable('expected assertTimezone to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).exitCode).toBe(3)
      expect((error as BootAssertionError).message).toMatch(/UTC/)
      expect((error as BootAssertionError).message).toMatch(/America\/Sao_Paulo/)
    }
  })
})

describe('assertForeignKeysEnabled', () => {
  it('passes when the pragma reports 1', () => {
    expect(() => assertForeignKeysEnabled(1)).not.toThrow()
  })

  it('throws exit code 3 when the pragma reports 0', () => {
    try {
      assertForeignKeysEnabled(0)
      expect.unreachable('expected assertForeignKeysEnabled to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).exitCode).toBe(3)
    }
  })
})

describe('assertIntegrityOk', () => {
  it('passes when the pragma reports "ok"', () => {
    expect(() => assertIntegrityOk('ok')).not.toThrow()
  })

  it('throws exit code 3 when the pragma reports anything else', () => {
    try {
      assertIntegrityOk('database disk image is malformed')
      expect.unreachable('expected assertIntegrityOk to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).exitCode).toBe(3)
      expect((error as BootAssertionError).message).toMatch(/malformed/)
    }
  })
})

describe('loadEnvConfig', () => {
  const validEnv = {
    BAR_PIN_HASH: 'scrypt$abcd$ef01',
    BAR_SESSION_SECRET: 'a'.repeat(64),
  }

  it('fills in the documented defaults when only the required vars are set', () => {
    const config = loadEnvConfig(validEnv)
    expect(config.port).toBe(8787)
    expect(config.host).toBe('127.0.0.1')
    expect(config.dbPath).toMatch(/\.local\/share\/motoclub\/bar\.sqlite3$/)
    expect(config.staticDir).toMatch(/dist$/)
  })

  it('honours explicit overrides', () => {
    const config = loadEnvConfig({
      ...validEnv,
      BAR_DB_PATH: '/tmp/custom.sqlite3',
      BAR_PORT: '9999',
      BAR_HOST: '127.0.0.1',
      BAR_STATIC_DIR: '/tmp/static',
    })
    expect(config.dbPath).toBe('/tmp/custom.sqlite3')
    expect(config.port).toBe(9999)
    expect(config.staticDir).toBe('/tmp/static')
  })

  it('throws exit code 2 naming the missing var(s) when BAR_PIN_HASH is absent', () => {
    try {
      loadEnvConfig({ BAR_SESSION_SECRET: validEnv.BAR_SESSION_SECRET })
      expect.unreachable('expected loadEnvConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).exitCode).toBe(2)
      expect((error as BootAssertionError).message).toMatch(/BAR_PIN_HASH/)
    }
  })

  it('throws exit code 2 naming the missing var(s) when BAR_SESSION_SECRET is absent', () => {
    try {
      loadEnvConfig({ BAR_PIN_HASH: validEnv.BAR_PIN_HASH })
      expect.unreachable('expected loadEnvConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).exitCode).toBe(2)
      expect((error as BootAssertionError).message).toMatch(/BAR_SESSION_SECRET/)
    }
  })

  it('refuses BAR_HOST=0.0.0.0 structurally, never binding beyond localhost', () => {
    try {
      loadEnvConfig({ ...validEnv, BAR_HOST: '0.0.0.0' })
      expect.unreachable('expected loadEnvConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(BootAssertionError)
      expect((error as BootAssertionError).message).toMatch(/0\.0\.0\.0/)
    }
  })

  it('rejects a non-numeric BAR_PORT', () => {
    expect(() => loadEnvConfig({ ...validEnv, BAR_PORT: 'not-a-port' })).toThrow(BootAssertionError)
  })
})
