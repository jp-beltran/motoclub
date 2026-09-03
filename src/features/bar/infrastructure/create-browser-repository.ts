import type { BarRepository } from '../application/bar-repository'
import { LocalBarRepository } from './local-bar-repository'

export function createBrowserBarRepository(): BarRepository {
  return new LocalBarRepository({
    storage: window.localStorage,
    nextId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  })
}
