const FALLBACK_TAB_ERROR_MESSAGE = 'Não foi possível atualizar a comanda. Tente novamente.'

// closeVisitorTab/reopenVisitorTab (local-bar-repository.ts) only ever throw
// a plain Error with one of these English messages. The repository is not
// this area's to change, so this maps its known messages to pt-BR sentences
// at the UI boundary and falls back to a generic pt-BR message for anything
// else, following the same pattern as ui/inventory/movement-utils.ts.
const TAB_ERROR_MESSAGES: Record<string, string> = {
  'Tab not found': 'Comanda não encontrada. Atualize a página e tente novamente.',
  'Tab must belong to a visitor': 'Esta ação está disponível apenas para comandas de visitante.',
  'Event must be active': 'Só é possível fechar ou reabrir comandas de um evento ativo.',
}

export function describeTabError(error: unknown): string {
  if (error instanceof Error && error.message in TAB_ERROR_MESSAGES) {
    return TAB_ERROR_MESSAGES[error.message]
  }
  return FALLBACK_TAB_ERROR_MESSAGE
}
