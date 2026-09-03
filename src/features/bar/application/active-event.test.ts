import { describe, expect, it } from 'vitest'

import { EVENT_STATUS } from '../domain/constants'
import type { Event } from '../domain/entities'
import { getActiveEvent } from './active-event'

function buildEvent(overrides: Partial<Event> & Pick<Event, 'id' | 'startsAt'>): Event {
  return {
    name: 'Evento',
    status: EVENT_STATUS.ACTIVE,
    ...overrides,
  }
}

describe('getActiveEvent', () => {
  it('returns undefined when there is no active event', () => {
    const events = [
      buildEvent({ id: 'event-1', startsAt: '2026-09-01T00:00:00.000Z', status: EVENT_STATUS.CLOSED }),
    ]

    expect(getActiveEvent(events)).toBeUndefined()
  })

  it('returns undefined for an empty list', () => {
    expect(getActiveEvent([])).toBeUndefined()
  })

  it('returns the only active event', () => {
    const active = buildEvent({ id: 'event-active', startsAt: '2026-09-01T00:00:00.000Z' })
    const closed = buildEvent({
      id: 'event-closed',
      startsAt: '2026-09-05T00:00:00.000Z',
      status: EVENT_STATUS.CLOSED,
    })

    expect(getActiveEvent([active, closed])).toEqual(active)
  })

  it('returns the most recent active event when there are two, regardless of array order', () => {
    const older = buildEvent({ id: 'event-older', startsAt: '2026-09-01T00:00:00.000Z' })
    const newer = buildEvent({ id: 'event-newer', startsAt: '2026-09-19T18:00:00.000Z' })

    expect(getActiveEvent([older, newer])).toEqual(newer)
    expect(getActiveEvent([newer, older])).toEqual(newer)
  })
})
