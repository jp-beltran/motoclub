import { useState } from 'react'

import { useBarSnapshot } from '../../application/queries'
import { getCurrentMonth } from '../../../../shared/date'
import { Button } from '../../../../shared/ui/Button'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { ConsumerDetail } from './ConsumerDetail'
import { ConsumerFilters } from './ConsumerFilters'
import { ConsumerList } from './ConsumerList'
import { ALL_CONSUMER_KINDS, filterConsumers, type ConsumerKindFilter } from './consumer-filters'
import { listConsumerHistory } from './consumer-history'
import { getConsumerOutstandingCents } from './consumer-outstanding'
import { VisitorQuickForm } from './VisitorQuickForm'

/**
 * `/consumidores`: search and filter every member and visitor, see each
 * one's outstanding total at a glance, register a walk-in visitor on the
 * spot, and drill into one consumer's full consumption history.
 */
export function ConsumersView() {
  const snapshotQuery = useBarSnapshot()
  const [searchTerm, setSearchTerm] = useState('')
  const [kind, setKind] = useState<ConsumerKindFilter>(ALL_CONSUMER_KINDS)
  const [selectedConsumerId, setSelectedConsumerId] = useState<string>()
  const [isRegistering, setIsRegistering] = useState(false)

  if (!snapshotQuery.data) return null

  const snapshot = snapshotQuery.data
  const month = getCurrentMonth()

  const rows = filterConsumers(snapshot.consumers, { searchTerm, kind }).map((consumer) => ({
    consumer,
    outstandingCents: getConsumerOutstandingCents(snapshot, consumer, month),
  }))

  const selectedConsumer = snapshot.consumers.find(
    (consumer) => consumer.id === selectedConsumerId,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content-primary">Consumidores</h1>
          <p className="mt-1 text-sm text-content-muted">
            Integrantes e visitantes com consumo no motoclube.
          </p>
        </div>
        <Button
          variant={isRegistering ? 'ghost' : 'primary'}
          aria-expanded={isRegistering}
          onClick={() => setIsRegistering((current) => !current)}
        >
          Novo visitante
        </Button>
      </div>

      {isRegistering ? (
        <VisitorQuickForm
          onCreated={(visitor) => {
            setIsRegistering(false)
            setSelectedConsumerId(visitor.id)
          }}
          onCancel={() => setIsRegistering(false)}
        />
      ) : null}

      <ConsumerFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        kind={kind}
        onKindChange={setKind}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum consumidor encontrado"
          description={
            snapshot.consumers.length === 0
              ? 'Cadastre o primeiro visitante para começar.'
              : 'Ajuste a busca ou o filtro para encontrar um consumidor.'
          }
        />
      ) : (
        <ConsumerList
          rows={rows}
          selectedConsumerId={selectedConsumerId}
          onSelect={(consumer) => setSelectedConsumerId(consumer.id)}
        />
      )}

      {selectedConsumer ? (
        <ConsumerDetail
          consumer={selectedConsumer}
          outstandingCents={getConsumerOutstandingCents(snapshot, selectedConsumer, month)}
          history={listConsumerHistory(snapshot, selectedConsumer.id)}
          onClose={() => setSelectedConsumerId(undefined)}
        />
      ) : null}
    </div>
  )
}
