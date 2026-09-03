import { useState } from 'react'

import { getActiveEvent } from '../../application/active-event'
import { useBarSnapshot } from '../../application/queries'
import { summarizeTab } from '../../application/tab-summary'
import { CHARGE_KIND, STOCK_WARNING, type ChargeKind } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { ConsumerStep } from './ConsumerStep'
import { ItemStep } from './ItemStep'
import { LaunchFeedback } from './LaunchFeedback'
import { RecentLaunches } from './RecentLaunches'
import { TabPanel } from './TabPanel'
import { resolveConsumerTab } from './consumer-tab'
import { describeLaunchError } from './launch-messages'
import {
  useCancelConsumption,
  useEditConsumptionQuantity,
  useLaunchConsumption,
  useReassignConsumption,
} from './use-launch-mutations'
import { getCurrentMonth } from '../../../../shared/date'
import { formatQuantity } from '../../../../shared/format'

const INSUFFICIENT_STOCK_MESSAGE =
  'Estoque insuficiente para este item. O lançamento foi registrado — confira o estoque.'

interface Feedback {
  readonly message: string
  readonly tone: 'success' | 'error'
  readonly warning?: string
  /** Present only while the launch it describes can still be undone. */
  readonly undoConsumptionId?: string
}

/**
 * The two steps of the central flow: pick who is consuming, then tap what they
 * consumed. The selected consumer is held here and never cleared by a launch,
 * which is what keeps every consumption after the first at a single tap.
 */
export function LaunchScreen() {
  const snapshotQuery = useBarSnapshot()
  const [selected, setSelected] = useState<Consumer>()
  const [feedback, setFeedback] = useState<Feedback>()
  const [isTabOpen, setIsTabOpen] = useState(false)

  const launchConsumption = useLaunchConsumption()
  const cancelConsumption = useCancelConsumption()
  const editQuantity = useEditConsumptionQuantity()
  const reassign = useReassignConsumption()

  // The app shell already renders the loading and persistence-error states.
  if (!snapshotQuery.data) return null
  const snapshot = snapshotQuery.data

  const month = getCurrentMonth()
  const activeEvent = getActiveEvent(snapshot.events)
  // Re-read the selection from the snapshot so a rename or deactivation shows.
  const consumer = selected
    ? snapshot.consumers.find(({ id }) => id === selected.id) ?? selected
    : undefined
  const resolution = consumer ? resolveConsumerTab(snapshot, consumer, month) : undefined
  // A const, so narrowing survives into the callback below.
  const undoConsumptionId = feedback?.undoConsumptionId
  const summary =
    resolution?.kind === 'ready' ? summarizeTab(snapshot, resolution.tab.id) : undefined

  function handleLaunch(itemId: string, quantity: number, chargeKind: ChargeKind) {
    if (!consumer) return
    const item = snapshot.items.find(({ id }) => id === itemId)
    launchConsumption.mutate(
      { consumer, month, activeEventId: activeEvent?.id, itemId, quantity, chargeKind },
      {
        onSuccess: (result) => {
          setFeedback({
            message: `${formatQuantity(quantity)}× ${item?.name ?? 'item'} para ${consumer.name}${
              chargeKind === CHARGE_KIND.COURTESY ? ' (cortesia)' : ''
            }`,
            tone: 'success',
            warning: result.warnings.includes(STOCK_WARNING.INSUFFICIENT)
              ? INSUFFICIENT_STOCK_MESSAGE
              : undefined,
            undoConsumptionId: result.consumption.id,
          })
        },
        onError: (error) => {
          setFeedback({ message: describeLaunchError(error), tone: 'error' })
        },
      },
    )
  }

  function handleUndo(consumptionId: string) {
    cancelConsumption.mutate(consumptionId, {
      onSuccess: () => {
        setFeedback({ message: 'Lançamento desfeito.', tone: 'success' })
      },
      onError: (error) => {
        setFeedback({ message: describeLaunchError(error), tone: 'error' })
      },
    })
  }

  function handleEditQuantity(consumptionId: string, quantity: number) {
    editQuantity.mutate(
      { consumptionId, quantity },
      {
        onSuccess: () => {
          setFeedback({
            message: `Quantidade alterada para ${formatQuantity(quantity)}.`,
            tone: 'success',
          })
        },
        onError: (error) => {
          setFeedback({ message: describeLaunchError(error), tone: 'error' })
        },
      },
    )
  }

  function handleReassign(consumptionId: string, targetTabId: string) {
    reassign.mutate(
      { consumptionId, targetTabId },
      {
        onSuccess: (consumption) => {
          const name = snapshot.consumers.find(({ id }) => id === consumption.consumerId)?.name
          setFeedback({
            message: `Lançamento movido para ${name ?? 'outro consumidor'}.`,
            tone: 'success',
          })
        },
        onError: (error) => {
          setFeedback({ message: describeLaunchError(error), tone: 'error' })
        },
      },
    )
  }

  function handleCancel(consumptionId: string) {
    cancelConsumption.mutate(consumptionId, {
      onSuccess: () => {
        setFeedback({ message: 'Lançamento cancelado.', tone: 'success' })
      },
      onError: (error) => {
        setFeedback({ message: describeLaunchError(error), tone: 'error' })
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content-primary">Lançamentos</h1>
        <ol className="flex flex-wrap gap-4 text-sm">
          <StepLabel index={1} label="Consumidor" isCurrent={!consumer} />
          <StepLabel index={2} label="Itens" isCurrent={Boolean(consumer)} />
        </ol>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="flex flex-1 flex-col gap-4">
          {consumer && resolution ? (
            <>
              <ItemStep
                consumer={consumer}
                items={snapshot.items.filter(({ active }) => active !== false)}
                resolution={resolution}
                onChangeConsumer={() => {
                  setSelected(undefined)
                  setFeedback(undefined)
                  setIsTabOpen(false)
                }}
                onLaunch={handleLaunch}
                onOpenTab={() => setIsTabOpen(true)}
              />
              {feedback ? (
                <LaunchFeedback
                  message={feedback.message}
                  tone={feedback.tone}
                  warning={feedback.warning}
                  isUndoing={cancelConsumption.isPending}
                  onUndo={
                    undoConsumptionId ? () => handleUndo(undoConsumptionId) : undefined
                  }
                />
              ) : null}
            </>
          ) : (
            <ConsumerStep
              consumers={snapshot.consumers.filter(({ active }) => active !== false)}
              onSelect={(picked) => {
                setSelected(picked)
                setFeedback(undefined)
              }}
            />
          )}
        </div>

        {consumer && isTabOpen ? (
          <TabPanel
            summary={summary}
            consumerName={consumer.name}
            onClose={() => setIsTabOpen(false)}
          />
        ) : null}
      </div>

      <RecentLaunches
        snapshot={snapshot}
        onEditQuantity={handleEditQuantity}
        onReassign={handleReassign}
        onCancel={handleCancel}
      />
    </div>
  )
}

interface StepLabelProps {
  readonly index: number
  readonly label: string
  readonly isCurrent: boolean
}

function StepLabel({ index, label, isCurrent }: StepLabelProps) {
  return (
    <li
      aria-current={isCurrent ? 'step' : undefined}
      className={isCurrent ? 'font-semibold text-content-primary' : 'text-content-muted'}
    >
      {`${index}. ${label}`}
      {isCurrent ? ' (atual)' : ''}
    </li>
  )
}
