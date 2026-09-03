import { useMutation } from '@tanstack/react-query'

import { EmptyState } from '../../../../shared/ui/EmptyState'
import { useBarSnapshot, useInvalidateBar } from '../../application/queries'
import { useBarRepository } from '../../application/repository-context'
import { describeTabError } from './tab-errors'
import { isEventActive } from './tab-status'
import { groupEventTabs } from './event-tab-groups'
import { TabCard } from './TabCard'

export function ComandasView() {
  const snapshotQuery = useBarSnapshot()
  const repository = useBarRepository()
  const invalidateBar = useInvalidateBar()

  const closeMutation = useMutation({
    mutationFn: (tabId: string) => repository.closeVisitorTab(tabId),
    onSuccess: () => invalidateBar(),
  })
  const reopenMutation = useMutation({
    mutationFn: (tabId: string) => repository.reopenVisitorTab(tabId),
    onSuccess: () => invalidateBar(),
  })

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-content-primary">Comandas</h1>
        <p className="mt-1 text-sm text-content-muted">
          Comandas de visitante por evento, com total e situação de pagamento.
        </p>
      </header>

      {snapshotQuery.isPending ? (
        <p className="text-content-muted">Carregando comandas…</p>
      ) : null}

      {snapshotQuery.isError ? (
        <EmptyState
          title="Não foi possível carregar as comandas"
          description="Tente novamente em instantes."
        />
      ) : null}

      {snapshotQuery.data ? (
        <TabGroups
          snapshot={snapshotQuery.data}
          onClose={(tabId) => closeMutation.mutate(tabId)}
          onReopen={(tabId) => reopenMutation.mutate(tabId)}
          closePendingTabId={closeMutation.isPending ? closeMutation.variables : undefined}
          reopenPendingTabId={reopenMutation.isPending ? reopenMutation.variables : undefined}
          closeErrorTabId={closeMutation.isError ? closeMutation.variables : undefined}
          reopenErrorTabId={reopenMutation.isError ? reopenMutation.variables : undefined}
          closeError={closeMutation.error}
          reopenError={reopenMutation.error}
        />
      ) : null}
    </div>
  )
}

interface TabGroupsProps {
  readonly snapshot: NonNullable<ReturnType<typeof useBarSnapshot>['data']>
  readonly onClose: (tabId: string) => void
  readonly onReopen: (tabId: string) => void
  readonly closePendingTabId?: string
  readonly reopenPendingTabId?: string
  readonly closeErrorTabId?: string
  readonly reopenErrorTabId?: string
  readonly closeError: unknown
  readonly reopenError: unknown
}

function TabGroups({
  snapshot,
  onClose,
  onReopen,
  closePendingTabId,
  reopenPendingTabId,
  closeErrorTabId,
  reopenErrorTabId,
  closeError,
  reopenError,
}: TabGroupsProps) {
  const groups = groupEventTabs(snapshot)

  if (groups.length === 0) {
    return (
      <EmptyState
        title="Nenhuma comanda de evento"
        description="Ainda não há comanda de visitante aberta para nenhum evento."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.event.id}>
          <h2 className="mb-3 text-lg font-semibold text-content-primary">{group.event.name}</h2>
          <div className="flex flex-col gap-3">
            {group.tabs.map((summary) => (
              <TabCard
                key={summary.tab.id}
                summary={summary}
                eventActive={isEventActive(group.event)}
                onClose={onClose}
                onReopen={onReopen}
                isClosePending={closePendingTabId === summary.tab.id}
                isReopenPending={reopenPendingTabId === summary.tab.id}
                closeErrorMessage={
                  closeErrorTabId === summary.tab.id ? describeTabError(closeError) : undefined
                }
                reopenErrorMessage={
                  reopenErrorTabId === summary.tab.id ? describeTabError(reopenError) : undefined
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
