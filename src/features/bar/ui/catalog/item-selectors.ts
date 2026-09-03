import type { Item } from '../../domain/entities'

export const ALL_CATEGORIES = ''

const marginRatioFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatMarginRatio(ratio: number): string {
  return marginRatioFormatter.format(ratio)
}

export interface CatalogFilters {
  readonly searchTerm: string
  readonly category: string
}

export function isItemActive(item: Item): boolean {
  return item.active !== false
}

export function splitItemsByStatus(items: readonly Item[]): {
  active: Item[]
  inactive: Item[]
} {
  const active: Item[] = []
  const inactive: Item[] = []
  for (const item of items) {
    if (isItemActive(item)) {
      active.push(item)
    } else {
      inactive.push(item)
    }
  }
  return { active, inactive }
}

export function getItemCategories(items: readonly Item[]): string[] {
  const categories = new Set<string>()
  for (const item of items) {
    if (item.category) categories.add(item.category)
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export function filterCatalogItems(
  items: readonly Item[],
  filters: CatalogFilters,
): Item[] {
  const term = filters.searchTerm.trim().toLowerCase()
  return items.filter((item) => {
    const matchesCategory =
      filters.category === ALL_CATEGORIES || item.category === filters.category
    if (!matchesCategory) return false
    if (!term) return true
    const nameMatches = item.name.toLowerCase().includes(term)
    const codeMatches = item.code?.toLowerCase().includes(term) ?? false
    return nameMatches || codeMatches
  })
}
