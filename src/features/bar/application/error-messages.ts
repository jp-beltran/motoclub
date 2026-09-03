const FALLBACK_MESSAGE = 'Não foi possível concluir a operação. Tente novamente.'

/**
 * The domain and the repository raise their invariants in English, for the
 * developer. The operator gets the pt-BR sentence for the ones they can act
 * on, and a plain retry message for anything unexpected.
 *
 * This lives in the application layer because more than one area surfaces the
 * same repository failures: an area must never reach into another area's UI
 * folder for it.
 */
const MESSAGES_BY_CAUSE: Readonly<Record<string, string>> = {
  'Cannot add consumption to a closed tab':
    'Esta comanda está fechada e não aceita novos lançamentos.',
  'Event must be active': 'O evento desta comanda não está ativo.',
  'Monthly tab month must match the current month':
    'A comanda mensal só pode ser aberta no mês corrente.',
  'Consumer must be an active member': 'O consumidor precisa ser um integrante ativo.',
  'Consumer must be an active visitor': 'O consumidor precisa ser um visitante ativo.',
  'Target tab must be open and compatible':
    'A comanda de destino precisa estar aberta e ser do mesmo tipo.',
  'Only active consumption can be reassigned': 'Só é possível mover um lançamento ativo.',
  'Only active consumption can be cancelled': 'Este lançamento já foi cancelado.',
  'Quantity must be a positive integer':
    'A quantidade precisa ser um número inteiro maior que zero.',
  'Consumption quantity must be a positive safe integer':
    'A quantidade precisa ser um número inteiro maior que zero.',
  'Visitor name is required': 'Informe o nome do visitante.',
}

export function describeRepositoryError(error: unknown): string {
  if (!(error instanceof Error)) return FALLBACK_MESSAGE
  return MESSAGES_BY_CAUSE[error.message] ?? FALLBACK_MESSAGE
}
