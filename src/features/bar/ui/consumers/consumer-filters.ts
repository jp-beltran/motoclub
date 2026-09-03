import type { ConsumerKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'

/** Sentinel kind filter meaning "no kind restriction". */
export const ALL_CONSUMER_KINDS = 'all'

export type ConsumerKindFilter = typeof ALL_CONSUMER_KINDS | ConsumerKind

export interface ConsumerFilterOptions {
  readonly searchTerm: string
  readonly kind: ConsumerKindFilter
}

/** Narrows consumers by a trimmed, case-insensitive name search and by kind. */
export function filterConsumers(
  consumers: readonly Consumer[],
  { searchTerm, kind }: ConsumerFilterOptions,
): Consumer[] {
  const term = searchTerm.trim().toLocaleLowerCase('pt-BR')

  return consumers.filter((consumer) => {
    if (kind !== ALL_CONSUMER_KINDS && consumer.kind !== kind) return false
    if (!term) return true
    return consumer.name.toLocaleLowerCase('pt-BR').includes(term)
  })
}
