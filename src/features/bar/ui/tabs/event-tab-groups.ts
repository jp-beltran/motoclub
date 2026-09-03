import type { BarDatabase } from '../../application/bar-repository'
import { summarizeTab, type TabSummary } from '../../application/tab-summary'
import { TAB_KIND } from '../../domain/constants'
import type { Event, EventTab } from '../../domain/entities'

export interface EventTabGroup {
  readonly event: Event
  /** Event tab summaries, ordered by when each tab was opened. */
  readonly tabs: readonly TabSummary[]
}

/**
 * Groups every event tab (comanda de visitante) under its event, most
 * recently started event first. Monthly tabs never appear here — a
 * member's debt is read on the closing/statement screens instead. An event
 * with no visitor tab at all is omitted rather than shown empty.
 */
export function groupEventTabs(snapshot: BarDatabase): readonly EventTabGroup[] {
  const eventTabsByEventId = new Map<string, EventTab[]>()
  snapshot.tabs.forEach((tab) => {
    if (tab.kind !== TAB_KIND.EVENT) return
    const list = eventTabsByEventId.get(tab.eventId) ?? []
    list.push(tab)
    eventTabsByEventId.set(tab.eventId, list)
  })

  return snapshot.events
    .filter((event) => (eventTabsByEventId.get(event.id) ?? []).length > 0)
    .slice()
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
    .map((event) => ({
      event,
      tabs: (eventTabsByEventId.get(event.id) ?? [])
        .slice()
        .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())
        .map((tab) => summarizeTab(snapshot, tab.id))
        .filter((summary): summary is TabSummary => summary !== undefined),
    }))
}
