import type {
  Consumption,
  MemberStatement,
  MonthlyClosing,
} from './entities'
import type { DomainDependencies } from './dependencies'

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const INVALID_MONTH_MESSAGE = 'Month must use YYYY-MM format'

export interface ConsolidateMonthInput {
  readonly month: string
  readonly memberIds: readonly string[]
  readonly consumptions: readonly Consumption[]
  readonly actorId: string
}

export interface MonthlyConsolidation {
  readonly closing: MonthlyClosing
  readonly statements: readonly MemberStatement[]
}

export function consolidateMonth(
  input: ConsolidateMonthInput,
  dependencies: DomainDependencies,
): MonthlyConsolidation {
  if (!MONTH_PATTERN.test(input.month)) {
    throw new Error(INVALID_MONTH_MESSAGE)
  }

  const createdAt = dependencies.now()
  const statements = input.memberIds.flatMap((memberId) => {
    const consumptions = input.consumptions
      .filter(
        (consumption) =>
          consumption.consumerId === memberId &&
          consumption.createdAt.startsWith(`${input.month}-`),
      )
      .map((consumption) => Object.freeze({ ...consumption }))

    if (consumptions.length === 0) return []

    return [{
      id: dependencies.nextId(),
      memberId,
      month: input.month,
      consumptions: Object.freeze(consumptions),
      createdAt,
    }]
  })
  const closing: MonthlyClosing = {
    id: dependencies.nextId(),
    month: input.month,
    statementIds: statements.map(({ id }) => id),
    closedAt: createdAt,
    actorId: input.actorId,
  }

  return { closing, statements }
}
