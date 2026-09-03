const FALLBACK_MESSAGE = 'Não foi possível fechar o mês. Tente novamente.'

/**
 * The repository raises its invariants in English, for the developer. The
 * operator gets the pt-BR sentence for the one they can act on — the screen
 * should already disable the "Fechar mês" action once a closing exists for
 * the month, so this mapping is a defensive fallback for a stale click that
 * still reaches the repository.
 */
const MESSAGES_BY_CAUSE: Readonly<Record<string, string>> = {
  'Monthly closing already exists': 'Este mês já foi fechado. Não é possível fechá-lo novamente.',
}

export function describeClosingError(error: unknown): string {
  if (!(error instanceof Error)) return FALLBACK_MESSAGE
  return MESSAGES_BY_CAUSE[error.message] ?? FALLBACK_MESSAGE
}
