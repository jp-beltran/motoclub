import { describe, expect, it } from 'vitest'

import { CONSUMER_KIND } from '../domain/constants'
import { DEFAULT_STORAGE_KEY, LocalBarRepository } from './local-bar-repository'
import { createEmptyDatabase } from './empty-database'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function createRepository(storage = new MemoryStorage()) {
  let id = 0
  const repository = new LocalBarRepository({
    storage,
    nextId: () => `new-${++id}`,
    now: () => '2026-09-21T18:00:00.000Z',
  })
  return { repository, storage }
}

function seedEmpty(storage: MemoryStorage) {
  storage.setItem(
    DEFAULT_STORAGE_KEY,
    JSON.stringify({ version: 1, data: createEmptyDatabase() }),
  )
}

/**
 * O banco vazio existe para o bar de verdade não abrir o primeiro dia com Ana
 * Paula, Bruno Santos e quatro lançamentos que nunca aconteceram. O risco não
 * é estético: é fácil demais lançar uma cerveja no integrante de mentira e só
 * perceber no fechamento.
 */
describe('createEmptyDatabase', () => {
  it('não traz nada em nenhuma coleção', () => {
    for (const [colecao, valor] of Object.entries(createEmptyDatabase())) {
      expect(valor, `coleção ${colecao}`).toEqual([])
    }
  })

  it('é aceito pelo repositório: ler um banco vazio não é erro', async () => {
    const storage = new MemoryStorage()
    seedEmpty(storage)
    const { repository } = createRepository(storage)

    const snapshot = await repository.getSnapshot()

    expect(snapshot.consumers).toEqual([])
    expect(snapshot.items).toEqual([])
    expect(snapshot.events).toEqual([])
  })

  /**
   * Este é o teste que importa. Apagar o arquivo do banco NÃO deixa o sistema
   * vazio: quando o armazenamento devolve `null`, `load` grava a demonstração
   * de volta. Só a presença do documento evita esse ramo — e é exatamente
   * isso que `server/main.ts` faz na primeira subida.
   */
  it('com o documento presente, o repositório nunca semeia a demonstração', async () => {
    const storage = new MemoryStorage()
    seedEmpty(storage)
    const { repository } = createRepository(storage)

    const snapshot = await repository.getSnapshot()

    expect(snapshot.consumers).toHaveLength(0)
    // A demonstração traria estes dois; a ausência deles é o que provamos.
    expect(JSON.stringify(snapshot)).not.toContain('Ana Paula')
    expect(JSON.stringify(snapshot)).not.toContain('Cerveja lata')
  })

  it('sem o documento, o repositório AINDA semeia a demonstração', async () => {
    // O contrário do teste acima, pinado de propósito: é o comportamento que
    // serve quem desenvolve, e o motivo de o vazio precisar ser escrito em vez
    // de o arquivo ser apagado.
    const { repository } = createRepository()

    const snapshot = await repository.getSnapshot()

    expect(snapshot.consumers.length).toBeGreaterThan(0)
  })

  it('um banco vazio aceita o primeiro cadastro do clube', async () => {
    const storage = new MemoryStorage()
    seedEmpty(storage)
    const { repository } = createRepository(storage)

    const integrante = await repository.createConsumer({
      name: 'Primeiro Integrante',
      kind: CONSUMER_KIND.MEMBER,
    })
    const item = await repository.createItem({
      name: 'Cerveja do clube',
      unitPriceCents: 700,
      unitCostCents: 350,
      stockQuantity: 24,
    })

    expect(await repository.listConsumers()).toEqual([integrante])
    expect(await repository.listItems()).toEqual([item])
  })

  /**
   * Num banco vazio não há evento ativo, e é só assim que `selectOrCreateActiveEvent`
   * chega ao ramo que CRIA — com a semente, ele sempre encontrava um evento em
   * curso e devolvia esse, ignorando o nome pedido.
   */
  it('num banco vazio dá para abrir o primeiro evento', async () => {
    const storage = new MemoryStorage()
    seedEmpty(storage)
    const { repository } = createRepository(storage)

    const evento = await repository.selectOrCreateActiveEvent({ name: 'Encontro de estreia' })

    expect(evento.name).toBe('Encontro de estreia')
    expect(await repository.listEvents()).toHaveLength(1)
  })
})
