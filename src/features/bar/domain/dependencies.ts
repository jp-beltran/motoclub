export interface DomainDependencies {
  readonly nextId: () => string
  readonly now: () => string
}
