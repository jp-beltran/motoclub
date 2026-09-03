import { describe, expect, it } from 'vitest'

import { EVENT_STATUS, PAYMENT_STATUS, TAB_STATUS } from '../../domain/constants'
import type { Event } from '../../domain/entities'
import { formatPaymentStatusLabel, formatTabStatusLabel, isEventActive } from './tab-status'

describe('formatTabStatusLabel', () => {
  it('labels an open tab in pt-BR', () => {
    expect(formatTabStatusLabel(TAB_STATUS.OPEN)).toBe('Aberta')
  })

  it('labels a closed tab in pt-BR', () => {
    expect(formatTabStatusLabel(TAB_STATUS.CLOSED)).toBe('Fechada')
  })
})

describe('formatPaymentStatusLabel', () => {
  it('labels unpaid in pt-BR', () => {
    expect(formatPaymentStatusLabel(PAYMENT_STATUS.UNPAID)).toBe('Não pago')
  })

  it('labels partial in pt-BR', () => {
    expect(formatPaymentStatusLabel(PAYMENT_STATUS.PARTIAL)).toBe('Parcial')
  })

  it('labels paid in pt-BR', () => {
    expect(formatPaymentStatusLabel(PAYMENT_STATUS.PAID)).toBe('Pago')
  })
})

describe('isEventActive', () => {
  const activeEvent: Event = {
    id: 'event-1', name: 'Encontro', startsAt: '2026-09-19T18:00:00.000Z',
    status: EVENT_STATUS.ACTIVE,
  }
  const closedEvent: Event = {
    id: 'event-2', name: 'Aniversário', startsAt: '2026-09-05T18:00:00.000Z',
    status: EVENT_STATUS.CLOSED,
  }

  it('is true for an active event', () => {
    expect(isEventActive(activeEvent)).toBe(true)
  })

  it('is false for a closed event', () => {
    expect(isEventActive(closedEvent)).toBe(false)
  })

  it('is false when the event is undefined', () => {
    expect(isEventActive(undefined)).toBe(false)
  })
})
