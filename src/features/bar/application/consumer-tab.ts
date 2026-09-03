import { getActiveEvent } from './active-event'
import type { BarDatabase } from './bar-repository'
import { CONSUMER_KIND, TAB_KIND, TAB_STATUS } from '../domain/constants'
import type { Consumer, Consumption, Tab } from '../domain/entities'

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
  /**
   * No launch is possible. The tab is carried when one exists, because a
   * closed tab still holds a balance the operator has to be able to read.
   * Only `no-active-event` has no tab at all.
   */
  | { readonly kind: 'blocked'; readonly reason: LaunchBlockReason; readonly tab?: Tab }

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
    : { kind: 'blocked', reason: 'monthly-tab-closed', tab }
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
    : { kind: 'blocked', reason: 'event-tab-closed', tab }
}

/**
 * The tab a resolution points at, if any. A blocked resolution can still have
 * one, so the balance stays readable when launching is not.
 */
export function getResolvedTab(resolution: ConsumerTabResolution): Tab | undefined {
  return resolution.kind === 'pending' ? undefined : resolution.tab
}

/**
 * Whether opening the tab panel would tell the truth. It would for an open
 * tab, for a closed one that still owes money, and for a member with no tab
 * yet (nothing consumed). It would not when no event is active, because then
 * no visitor tab exists to describe.
 */
export function hasViewableTab(resolution: ConsumerTabResolution): boolean {
  return resolution.kind !== 'blocked' || resolution.tab !== undefined
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
