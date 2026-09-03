import { getActiveEvent } from '../../application/active-event'
import type { BarDatabase } from '../../application/bar-repository'
import { CONSUMER_KIND, TAB_KIND, TAB_STATUS } from '../../domain/constants'
import type { Consumer, Consumption, Tab } from '../../domain/entities'

/** Why a selected consumer cannot receive new consumption right now. */
export type LaunchBlockReason =
  | 'no-active-event'
  | 'monthly-tab-closed'
  | 'event-tab-closed'

export type ConsumerTabResolution =
  /** An open tab already exists, so its balance can be shown before launching. */
  | { readonly kind: 'ready'; readonly tab: Tab }
  /** No tab yet — the repository opens one on the first launch. */
  | { readonly kind: 'pending' }
  | { readonly kind: 'blocked'; readonly reason: LaunchBlockReason }

export interface ReassignTarget {
  readonly tabId: string
  readonly consumerName: string
}

/**
 * Which tab a launch for `consumer` would land on, read from the snapshot
 * alone. Resolving before the tap is what lets the screen explain an
 * impossible launch instead of letting the repository throw on it.
 */
export function resolveConsumerTab(
  snapshot: BarDatabase,
  consumer: Consumer,
  month: string,
): ConsumerTabResolution {
  return consumer.kind === CONSUMER_KIND.MEMBER
    ? resolveMonthlyTab(snapshot, consumer, month)
    : resolveEventTab(snapshot, consumer)
}

function resolveMonthlyTab(
  snapshot: BarDatabase,
  member: Consumer,
  month: string,
): ConsumerTabResolution {
  const tab = snapshot.tabs.find(
    (candidate) =>
      candidate.kind === TAB_KIND.MONTHLY &&
      candidate.memberId === member.id &&
      candidate.month === month,
  )
  if (!tab) return { kind: 'pending' }
  return tab.status === TAB_STATUS.OPEN
    ? { kind: 'ready', tab }
    : { kind: 'blocked', reason: 'monthly-tab-closed' }
}

function resolveEventTab(snapshot: BarDatabase, visitor: Consumer): ConsumerTabResolution {
  const activeEvent = getActiveEvent(snapshot.events)
  if (!activeEvent) return { kind: 'blocked', reason: 'no-active-event' }

  const tab = snapshot.tabs.find(
    (candidate) =>
      candidate.kind === TAB_KIND.EVENT &&
      candidate.eventId === activeEvent.id &&
      candidate.visitorId === visitor.id,
  )
  if (!tab) return { kind: 'pending' }
  return tab.status === TAB_STATUS.OPEN
    ? { kind: 'ready', tab }
    : { kind: 'blocked', reason: 'event-tab-closed' }
}

/**
 * Tabs a consumption may be moved to. The repository only accepts an open tab
 * of the same kind, and moving a monthly consumption across months would move
 * debt between closings, so both are filtered out before the operator can
 * pick an option that would only fail.
 */
export function listReassignTargets(
  snapshot: BarDatabase,
  consumption: Consumption,
): readonly ReassignTarget[] {
  const source = snapshot.tabs.find(({ id }) => id === consumption.tabId)
  if (!source) return []

  const nameById = new Map(snapshot.consumers.map(({ id, name }) => [id, name]))

  return snapshot.tabs
    .filter(
      (tab) =>
        tab.id !== source.id &&
        tab.kind === source.kind &&
        tab.status === TAB_STATUS.OPEN &&
        (tab.kind !== TAB_KIND.MONTHLY ||
          source.kind !== TAB_KIND.MONTHLY ||
          tab.month === source.month),
    )
    .map((tab) => ({
      tabId: tab.id,
      consumerName:
        nameById.get(tab.kind === TAB_KIND.MONTHLY ? tab.memberId : tab.visitorId) ?? '',
    }))
    .sort((left, right) => left.consumerName.localeCompare(right.consumerName, 'pt-BR'))
}
