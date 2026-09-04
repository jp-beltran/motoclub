import {
  CANCELLATION_BLOCK_CODES,
  type CancellationBlock,
} from '../domain/cancellation'
import { isBarError, type BarErrorCode } from '../domain/errors'

/**
 * The one pt-BR table for the whole bar feature.
 *
 * The domain and the adapters raise their invariants as a `BarError` carrying
 * a `BarErrorCode`; this is the single place that turns a code into something
 * an operator can read and act on. It replaces the five tables that used to
 * string-match English sentences (`ui/payments/payment-errors.ts`,
 * `ui/inventory/movement-utils.ts`, `ui/tabs/tab-errors.ts`,
 * `ui/closing/closing-messages.ts` and the message map that lived here).
 *
 * It lives in the application layer because several UI areas surface the same
 * failures: an area must never reach into another area's UI folder for copy,
 * and none of them owns the seam.
 *
 * `Record<BarErrorCode, string>` with no index signature and no cast is the
 * point of the exercise: adding a code to the union without writing copy for
 * it here fails `tsc`, so a failure can never reach an operator as a bare
 * "Tente novamente" because someone forgot the sentence.
 */
export const BAR_ERROR_MESSAGES: Readonly<Record<BarErrorCode, string>> = {
  'consumer-not-found': 'Consumidor não encontrado. Atualize a página e tente novamente.',
  'event-not-found': 'Evento não encontrado. Atualize a página e tente novamente.',
  'item-not-found': 'Item não encontrado. Atualize a página e tente novamente.',
  'tab-not-found': 'Comanda não encontrada. Atualize a página e tente novamente.',
  'consumption-not-found': 'Lançamento não encontrado. Atualize a página e tente novamente.',
  'payment-target-not-found':
    'Alvo do pagamento não encontrado. Atualize a página e tente novamente.',

  'visitor-name-required': 'Informe o nome do visitante.',
  'event-name-required': 'Informe o nome do evento.',
  'consumer-not-active-member': 'O consumidor precisa ser um integrante ativo.',
  'consumer-not-active-visitor': 'O consumidor precisa ser um visitante ativo.',
  // Serve as duas telas que alcançam esta guarda: o lançamento de consumo e o
  // fechamento/reabertura de comandas de visitante.
  'event-not-active':
    'O evento desta comanda não está ativo. Só é possível lançar consumo ou alterar ' +
    'comandas de um evento ativo.',
  'active-event-required':
    'Nenhum evento ativo. Visitantes só recebem consumo durante um evento; ' +
    'abra um evento para lançar para este visitante.',

  'tab-closed': 'Esta comanda está fechada e não aceita novos lançamentos.',
  'tab-not-visitor-tab': 'Esta ação está disponível apenas para comandas de visitante.',
  'monthly-tab-month-mismatch': 'A comanda mensal só pode ser aberta no mês corrente.',
  'month-format-invalid': 'O mês informado é inválido. Use o formato AAAA-MM.',

  'quantity-invalid': 'A quantidade precisa ser um número inteiro maior que zero.',
  'consumption-quantity-invalid':
    'A quantidade precisa ser um número inteiro maior que zero.',
  'consumption-already-cancelled': 'Este lançamento já foi cancelado.',
  'consumption-not-reassignable': 'Só é possível mover um lançamento ativo.',
  'consumption-item-mismatch':
    'Este lançamento não corresponde ao item informado. ' +
    'Atualize a página e tente novamente.',
  'reassign-target-tab-invalid':
    'A comanda de destino precisa estar aberta e ser do mesmo tipo.',

  // Cancelamento recusado porque o dinheiro do lançamento já foi lido em
  // outro lugar. O painel de correção de `/lancamentos` desabilita o controle
  // e imprime estas mesmas frases, via `describeCancellationBlock`.
  'consumption-frozen-in-statement':
    'Este lançamento já foi consolidado no extrato mensal e não pode mais ser cancelado.',
  'consumption-tab-closed':
    'Esta comanda está fechada e o lançamento não pode mais ser cancelado.',
  'consumption-covered-by-payment':
    'Já existe pagamento registrado que cobre este lançamento.',

  'item-stock-not-tracked': 'Este item não possui controle de estoque.',
  'stock-movement-quantity-invalid': 'Informe uma quantidade válida.',
  'stock-entry-quantity-invalid': 'A quantidade de entrada deve ser maior que zero.',
  'stock-quantity-overflow': 'A quantidade resultante do estoque é inválida.',
  'stock-movement-mismatch':
    'A baixa de estoque original não confere com este lançamento. ' +
    'Atualize a página e tente novamente.',
  'consumption-stock-movement-missing':
    'Este lançamento não tem a baixa de estoque original e não pode ser cancelado. ' +
    'Ajuste o estoque manualmente.',

  'money-amount-invalid':
    'O valor informado é inválido. Verifique os valores cadastrados e tente novamente.',
  // A única guarda de "valor positivo" que a interface alcança é o registro de
  // pagamento, então a frase fala de pagamento.
  'money-amount-not-positive': 'Informe um valor de pagamento válido, maior que zero.',
  'money-total-overflow': 'O total ultrapassa o valor máximo suportado.',
  'money-product-overflow': 'O valor deste lançamento ultrapassa o valor máximo suportado.',
  'payment-exceeds-balance': 'O valor informado é maior do que o saldo em aberto.',
  'monthly-tab-payment-not-allowed':
    'Comandas mensais só podem ser pagas pelo extrato do integrante, ' +
    'após o fechamento do mês.',

  'monthly-closing-already-exists':
    'Este mês já foi fechado. Não é possível fechá-lo novamente.',
  'timestamp-invalid': 'A data informada é inválida.',

  'stored-data-malformed':
    'Os dados salvos neste navegador estão corrompidos. Restaure a demonstração para continuar.',
  'stored-data-unsupported-version':
    'Os dados salvos neste navegador estão em um formato não suportado. ' +
    'Restaure a demonstração para continuar.',
  'stored-data-invalid':
    'Os dados salvos neste navegador estão inconsistentes. ' +
    'Restaure a demonstração para continuar.',
  'database-mutation-invalid':
    'A operação deixaria os dados do bar inconsistentes e foi cancelada. ' +
    'Atualize a página e tente novamente.',
}

/**
 * What the operator reads when a failure carries no code we recognise — a
 * bug, a browser fault, a rejection that never was a `BarError`. One per
 * surface, so the sentence still names the action that failed instead of
 * degrading to a bare "algo deu errado".
 */
export const BAR_ERROR_FALLBACKS = {
  operation: 'Não foi possível concluir a operação. Tente novamente.',
  payment: 'Não foi possível registrar o pagamento. Tente novamente.',
  stockMovement: 'Não foi possível registrar a movimentação. Tente novamente.',
  tab: 'Não foi possível atualizar a comanda. Tente novamente.',
  monthlyClosing: 'Não foi possível fechar o mês. Tente novamente.',
  resetDemo: 'Não foi possível restaurar a demonstração. Tente novamente.',
} as const satisfies Readonly<Record<string, string>>

/**
 * The pt-BR sentence for a failure. A coded failure gets its own sentence;
 * anything else gets `fallback`, which the calling surface picks so the
 * generic case still says which action failed.
 */
export function describeBarError(
  error: unknown,
  fallback: string = BAR_ERROR_FALLBACKS.operation,
): string {
  return isBarError(error) ? BAR_ERROR_MESSAGES[error.code] : fallback
}

/**
 * The same sentence, whether the operator reads it on a control that is
 * already disabled or on the refusal that would have followed the click.
 * `/lancamentos` disables the correction actions the repository would refuse
 * and prints this next to them.
 *
 * Both paths resolve through `CANCELLATION_BLOCK_CODES` into the single table
 * above, so the disabled control and the refused mutation cannot drift into
 * two different explanations of one rule — and neither can fall back, because
 * every code in the union has copy.
 */
export function describeCancellationBlock(block: CancellationBlock): string {
  return BAR_ERROR_MESSAGES[CANCELLATION_BLOCK_CODES[block]]
}
