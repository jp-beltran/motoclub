import type { TabLine, TabSummary } from '../../application/tab-summary'
import { TAB_KIND } from '../../domain/constants'
import { formatCents, formatQuantity } from '../../../../shared/format'
import { Button } from '../../../../shared/ui/Button'

export interface TabPanelProps {
  readonly summary: TabSummary | undefined
  readonly consumerName: string
  readonly onClose: () => void
}

/**
 * The selected consumer's tab, on demand. Full screen on a phone so the
 * operator can read it at the counter, a side panel from `md` up.
 */
export function TabPanel({ summary, consumerName, onClose }: TabPanelProps) {
  return (
    <aside
      aria-label={`Comanda de ${consumerName}`}
      className="fixed inset-0 z-30 overflow-y-auto bg-surface-base p-4 md:static md:z-auto md:w-80 md:shrink-0 md:rounded-lg md:border md:border-border-subtle md:bg-surface-raised md:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-content-primary">Comanda</h2>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
      <p className="mt-1 text-sm text-content-muted">{consumerName}</p>

      {!summary || (summary.lines.length === 0 && summary.courtesyLines.length === 0) ? (
        <p className="mt-4 text-sm text-content-muted">Nenhum consumo lançado ainda.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {summary.lines.length > 0 ? (
            <LineList title="Consumo" lines={summary.lines} />
          ) : null}

          <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3">
            <span className="text-sm font-semibold text-content-primary">Total</span>
            <span className="text-lg font-semibold text-content-primary">
              {formatCents(summary.totalCents)}
            </span>
          </div>
          {summary.tab.kind === TAB_KIND.EVENT ? (
            <>
              <div className="flex items-baseline justify-between gap-3 text-sm text-content-muted">
                <span>Pago</span>
                <span>{formatCents(summary.payment.paidCents)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm text-content-muted">
                <span>Em aberto</span>
                <span>{formatCents(summary.payment.remainingCents)}</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-content-muted">
              O saldo do integrante é cobrado no extrato mensal, após o fechamento.
            </p>
          )}

          {summary.courtesyLines.length > 0 ? (
            <div className="border-t border-border-subtle pt-3">
              <LineList title="Cortesias (não somam no total)" lines={summary.courtesyLines} />
            </div>
          ) : null}
        </div>
      )}
    </aside>
  )
}

interface LineListProps {
  readonly title: string
  readonly lines: readonly TabLine[]
}

function LineList({ title, lines }: LineListProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.itemId} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-content-primary">
              {`${formatQuantity(line.quantity)}× ${line.itemName}`}
            </span>
            <span className="text-content-muted">{formatCents(line.subtotalCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
