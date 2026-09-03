const FALLBACK_PAYMENT_ERROR_MESSAGE = 'Não foi possível registrar o pagamento. Tente novamente.'

// recordPayment (local-bar-repository.ts) only ever throws a plain Error
// with one of these English messages. The repository is not this area's to
// change, so this maps its known messages to pt-BR sentences at the UI
// boundary and falls back to a generic pt-BR message for anything else,
// following the same pattern as ui/inventory/movement-utils.ts.
const PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  'Payment cannot exceed the amount due': 'O valor informado é maior do que o saldo em aberto.',
  'Monthly tab debt must be paid through its member statement':
    'Comandas mensais só podem ser pagas pelo extrato do integrante, após o fechamento do mês.',
  'Payment target not found': 'Alvo do pagamento não encontrado. Atualize a página e tente novamente.',
  'Money amounts must use positive safe integer cents':
    'Informe um valor de pagamento válido, maior que zero.',
}

export function describePaymentError(error: unknown): string {
  if (error instanceof Error && error.message in PAYMENT_ERROR_MESSAGES) {
    return PAYMENT_ERROR_MESSAGES[error.message]
  }
  return FALLBACK_PAYMENT_ERROR_MESSAGE
}
