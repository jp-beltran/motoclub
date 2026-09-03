import { describe, expect, it } from 'vitest'

import { CONSUMER_KIND } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { ALL_CONSUMER_KINDS, filterConsumers } from './consumer-filters'

const ANA: Consumer = { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER }
const BRUNO: Consumer = { id: 'member-bruno', name: 'Bruno Santos', kind: CONSUMER_KIND.MEMBER }
const RAFAEL: Consumer = { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR }
const CONSUMERS = [ANA, BRUNO, RAFAEL]

describe('filterConsumers', () => {
  it('returns everyone when the search term is empty and the kind is "all"', () => {
    expect(filterConsumers(CONSUMERS, { searchTerm: '', kind: ALL_CONSUMER_KINDS })).toEqual(
      CONSUMERS,
    )
  })

  it('matches by a case-insensitive, accent-insensitive-ish substring of the name', () => {
    expect(
      filterConsumers(CONSUMERS, { searchTerm: 'ana', kind: ALL_CONSUMER_KINDS }),
    ).toEqual([ANA])
  })

  it('trims the search term before matching', () => {
    expect(
      filterConsumers(CONSUMERS, { searchTerm: '  rafael  ', kind: ALL_CONSUMER_KINDS }),
    ).toEqual([RAFAEL])
  })

  it('narrows to one kind', () => {
    expect(
      filterConsumers(CONSUMERS, { searchTerm: '', kind: CONSUMER_KIND.VISITOR }),
    ).toEqual([RAFAEL])
  })

  it('combines search and kind filters', () => {
    expect(
      filterConsumers(CONSUMERS, { searchTerm: 'a', kind: CONSUMER_KIND.MEMBER }),
    ).toEqual([ANA, BRUNO])
  })

  it('returns an empty list when nothing matches', () => {
    expect(
      filterConsumers(CONSUMERS, { searchTerm: 'zzz', kind: ALL_CONSUMER_KINDS }),
    ).toEqual([])
  })
})
