import type { LaunchBlockReason } from '../../application/consumer-tab'

/** Why the launch step is unavailable, and what the operator can do about it. */
export const LAUNCH_BLOCK_MESSAGES: Record<LaunchBlockReason, string> = {
  'no-active-event':
    'Nenhum evento ativo. Visitantes só recebem consumo durante um evento; ' +
    'integrantes continuam disponíveis.',
  'monthly-tab-closed':
    'A comanda mensal deste integrante já foi fechada. ' +
    'Lançamentos deste mês não são mais aceitos — o saldo é cobrado no extrato.',
  'event-tab-closed':
    'A comanda deste visitante está fechada. Reabra a comanda para lançar consumo.',
}
