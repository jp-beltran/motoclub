import type { BarDatabase } from '../application/bar-repository'

/**
 * Um banco do bar sem nada dentro.
 *
 * Existe porque "vazio" e "ainda não existe" são estados diferentes, e o
 * repositório trata o segundo semeando a demonstração: `LocalBarRepository.load`
 * grava `createDemoDatabase()` quando o armazenamento devolve `null`. Isso é
 * certo para quem está desenvolvendo — abrir o app e ver um bar com movimento
 * é melhor que uma tela vazia — e errado para o bar de verdade, onde Ana Paula
 * e Bruno Santos não existem e alguém pode acabar lançando consumo neles.
 *
 * Então a instalação real grava ISTO na primeira subida (ver `server/main.ts`),
 * e com o documento presente o repositório nunca chega ao ramo que semeia.
 *
 * O tipo é `Record<keyof BarDatabase, never[]>` de propósito, e não
 * `BarDatabase`: se o modelo ganhar uma coleção nova e ninguém acrescentar a
 * linha aqui, o `tsc` cobra. Um "vazio" que esquece uma coleção produz um
 * documento que a revalidação recusa — e a recusa apareceria no boot do
 * notebook, não aqui.
 */
export function createEmptyDatabase(): BarDatabase {
  const vazio: Record<keyof BarDatabase, never[]> = {
    consumers: [],
    items: [],
    events: [],
    tabs: [],
    consumptions: [],
    payments: [],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
  }
  return vazio
}
