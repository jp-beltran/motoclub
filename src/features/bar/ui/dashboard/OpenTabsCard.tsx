import { Link } from 'react-router-dom'

import { Card } from '../../../../shared/ui/Card'
import { EmptyState } from '../../../../shared/ui/EmptyState'
import { formatQuantity } from '../../../../shared/format'

export interface OpenTabsCardProps {
  readonly openTabsCount: number
}

const LINK_CLASSES =
  'inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 ' +
  'hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent'

/** Support card: how many tabs (comandas) are currently open, linking to the comandas area. */
export function OpenTabsCard({ openTabsCount }: OpenTabsCardProps) {
  if (openTabsCount === 0) {
    return (
      <EmptyState
        title="Nenhuma comanda aberta"
        description="Não há consumo em andamento no momento."
        action={
          <Link to="/comandas" className={LINK_CLASSES}>
            Ver comandas
          </Link>
        }
      />
    )
  }

  return (
    <Card>
      <p className="text-sm text-content-muted">Comandas abertas</p>
      <p className="mt-1 text-2xl font-semibold text-content-primary">
        {formatQuantity(openTabsCount)}
      </p>
      <Link to="/comandas" className={`mt-2 ${LINK_CLASSES}`}>
        Ver comandas
      </Link>
    </Card>
  )
}
