import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from './schema'

describe('SCHEMA_SQL', () => {
  it('matches schema.sql byte-for-byte, so the inlined string and the file on disk never drift apart', () => {
    const fileContent = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
    expect(SCHEMA_SQL).toBe(fileContent)
  })
})
