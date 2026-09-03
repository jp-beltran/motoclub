import { CONSUMER_KIND } from '../../domain/constants'
import { ALL_CONSUMER_KINDS, type ConsumerKindFilter } from './consumer-filters'
import { Button } from '../../../../shared/ui/Button'

const FIELD_CLASSES =
  'min-h-11 w-full rounded-md border border-border-subtle bg-surface-raised px-3 text-sm ' +
  'text-content-primary placeholder:text-content-muted focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const KIND_OPTIONS: readonly { readonly value: ConsumerKindFilter; readonly label: string }[] = [
  { value: ALL_CONSUMER_KINDS, label: 'Todos' },
  { value: CONSUMER_KIND.MEMBER, label: 'Integrantes' },
  { value: CONSUMER_KIND.VISITOR, label: 'Visitantes' },
]

export interface ConsumerFiltersProps {
  readonly searchTerm: string
  readonly onSearchTermChange: (value: string) => void
  readonly kind: ConsumerKindFilter
  readonly onKindChange: (value: ConsumerKindFilter) => void
}

/** Search-by-name and filter-by-kind controls for the consumer list. */
export function ConsumerFilters({
  searchTerm,
  onSearchTermChange,
  kind,
  onKindChange,
}: ConsumerFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-content-muted">
        Buscar por nome
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="Digite um nome"
          className={FIELD_CLASSES}
        />
      </label>
      <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-2">
        {KIND_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={kind === option.value ? 'primary' : 'ghost'}
            aria-pressed={kind === option.value}
            onClick={() => onKindChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
