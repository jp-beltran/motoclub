import type { BarDatabase } from '../../application/bar-repository'
import { listReassignTargets } from './consumer-tab'
import { RecentLaunchRow } from './RecentLaunchRow'
import { RECENT_LAUNCH_LIMIT, listRecentLaunches } from './recent-launches'

export interface RecentLaunchesProps {
  readonly snapshot: BarDatabase
  readonly onEditQuantity: (consumptionId: string, quantity: number) => void
  readonly onReassign: (consumptionId: string, targetTabId: string) => void
  readonly onCancel: (consumptionId: string) => void
}

/** The day's last launches, so a mistake can be fixed where it is noticed. */
export function RecentLaunches({
  snapshot,
  onEditQuantity,
  onReassign,
  onCancel,
}: RecentLaunchesProps) {
  const launches = listRecentLaunches(snapshot, new Date())

  return (
    <section aria-labelledby="recent-launches-title" className="flex flex-col gap-3">
      <h2 id="recent-launches-title" className="text-lg font-semibold text-content-primary">
        Últimos lançamentos
      </h2>
      {launches.length === 0 ? (
        <p className="text-sm text-content-muted">Nenhum lançamento hoje.</p>
      ) : (
        <>
          <p className="text-sm text-content-muted">
            {`Os ${RECENT_LAUNCH_LIMIT} lançamentos mais recentes de hoje.`}
          </p>
          <ul className="flex flex-col gap-2">
            {launches.map((launch) => (
              <RecentLaunchRow
                key={launch.consumption.id}
                launch={launch}
                targets={listReassignTargets(snapshot, launch.consumption)}
                onEditQuantity={(quantity) =>
                  onEditQuantity(launch.consumption.id, quantity)
                }
                onReassign={(targetTabId) => onReassign(launch.consumption.id, targetTabId)}
                onCancel={() => onCancel(launch.consumption.id)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
