import { Route, Routes } from 'react-router-dom'

import { ComandasPage } from '../pages/ComandasPage'
import { ConsumidoresPage } from '../pages/ConsumidoresPage'
import { DashboardPage } from '../pages/DashboardPage'
import { EstoquePage } from '../pages/EstoquePage'
import { FechamentoPage } from '../pages/FechamentoPage'
import { ItensPage } from '../pages/ItensPage'
import { LancamentosPage } from '../pages/LancamentosPage'
import { PagamentosPage } from '../pages/PagamentosPage'
import { AppShell } from './layout/AppShell'

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/lancamentos" element={<LancamentosPage />} />
        <Route path="/consumidores" element={<ConsumidoresPage />} />
        <Route path="/itens" element={<ItensPage />} />
        <Route path="/comandas" element={<ComandasPage />} />
        <Route path="/fechamento" element={<FechamentoPage />} />
        <Route path="/pagamentos" element={<PagamentosPage />} />
        <Route path="/estoque" element={<EstoquePage />} />
      </Route>
    </Routes>
  )
}
