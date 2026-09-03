import { describe, expect, it } from 'vitest'

import type { LaunchBlockReason } from '../../application/consumer-tab'
import { LAUNCH_BLOCK_MESSAGES } from './launch-messages'

/**
 * Exhaustive by construction: this is a `Record` over the whole union with no
 * cast, so adding a `LaunchBlockReason` without listing it here stops the
 * build — and `LAUNCH_BLOCK_MESSAGES` has the same key type, so a new reason
 * cannot ship without copy for it.
 */
const EVERY_REASON: Record<LaunchBlockReason, true> = {
  'no-active-event': true,
  'monthly-tab-closed': true,
  'event-tab-closed': true,
}

describe('LAUNCH_BLOCK_MESSAGES', () => {
  it('covers every launch block reason and nothing else', () => {
    expect(Object.keys(LAUNCH_BLOCK_MESSAGES).sort()).toEqual(
      Object.keys(EVERY_REASON).sort(),
    )
  })

  it('gives each reason its own non-empty explanation', () => {
    const messages = Object.values(LAUNCH_BLOCK_MESSAGES)

    expect(messages.every((message) => message.trim().length > 0)).toBe(true)
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('tells the operator what to do, not just that it failed', () => {
    // Each message has to name the way forward, so the operator is never left
    // at a dead end: another consumer, the statement, or reopening the tab.
    expect(LAUNCH_BLOCK_MESSAGES['no-active-event']).toContain('integrantes')
    expect(LAUNCH_BLOCK_MESSAGES['monthly-tab-closed']).toContain('extrato')
    expect(LAUNCH_BLOCK_MESSAGES['event-tab-closed']).toContain('Reabra')
  })
})
