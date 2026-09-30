import type { RecipeSource } from '../types/recipe.ts'
import { LIMITS } from './recipeLimits.ts'

// What the recipe listing can be narrowed by (#14), and how that is written
// in a URL: the same query string in the address bar and in the request to
// GET /api/recipes, so a filtered view can be linked, reloaded and fetched
// without translating between them. Every filter narrows what the others
// left — they combine, and none replaces another.
export type RecipeFilters = {
  // Words in the title.
  q: string
  // Every one of these, whatever their case.
  tags: string[]
  // An ingredient whose name has each of these in it.
  ingredients: string[]
  // Ready in this many minutes or fewer. A recipe that states no time is
  // not known to be, and is left out.
  maxTime: number | null
  minPortions: number | null
  maxPortions: number | null
  // Any of these.
  sources: RecipeSource['type'][]
}

export const SOURCE_TYPES = ['website', 'instagram', 'photo', 'text'] as const satisfies readonly RecipeSource['type'][]

// Ceilings on what a query may carry, so a request cannot hand the listing
// statement a thousand patterns. Far past anything the filter panel makes.
export const FILTER_LIMITS = { q: 200, terms: 10, term: 100 }

export const NO_FILTERS: RecipeFilters = {
  q: '', tags: [], ingredients: [], maxTime: null, minPortions: null, maxPortions: null, sources: [],
}

type Query = Record<string, unknown>

const all = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])

/**
 * Filters from a query string as a router or h3 parses it: a key once is a
 * string, a key twice is an array. What cannot be read is left out and said
 * in `problems` — the server refuses a request with any, the app ignores them,
 * since an address someone typed by hand is still worth showing something for.
 *
 * Terms are trimmed and blanks dropped; the same term twice is kept once.
 */
export function readFilters(query: Query): { filters: RecipeFilters, problems: string[] } {
  const problems: string[] = []
  const terms = (key: string, what: string): string[] => {
    const kept: string[] = []
    for (const value of all(query[key])) {
      if (typeof value !== 'string') {
        problems.push(`Expected ${what} to be text.`)
        continue
      }
      const term = value.trim().replace(/\s+/g, ' ')
      if (!term) continue
      if ([...term].length > FILTER_LIMITS.term) problems.push(`A ${what} is limited to ${FILTER_LIMITS.term} characters.`)
      else if (!kept.some(k => k.toLowerCase() === term.toLowerCase())) kept.push(term)
    }
    if (kept.length > FILTER_LIMITS.terms) {
      problems.push(`At most ${FILTER_LIMITS.terms} ${what}s at once.`)
      return kept.slice(0, FILTER_LIMITS.terms)
    }
    return kept
  }
  const count = (key: string, what: string, max: number): number | null => {
    const values = all(query[key])
    if (!values.length) return null
    const value = values.at(-1)
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
    if (!Number.isSafeInteger(n) || n < 1 || n > max) {
      problems.push(`Expected ${what} to be a whole number from 1 to ${max}.`)
      return null
    }
    return n
  }

  // The last one given, as a form field typed into twice would send it.
  const search = all(query.q).at(-1)
  if (search !== undefined && typeof search !== 'string') problems.push('Expected q to be text.')
  let q = typeof search === 'string' ? search.trim().replace(/\s+/g, ' ') : ''
  if ([...q].length > FILTER_LIMITS.q) {
    problems.push(`A search is limited to ${FILTER_LIMITS.q} characters.`)
    q = ''
  }

  const sources: RecipeFilters['sources'] = []
  for (const value of all(query.source)) {
    if (!SOURCE_TYPES.includes(value as never)) problems.push(`Expected source to be one of ${SOURCE_TYPES.join(', ')}.`)
    else if (!sources.includes(value as never)) sources.push(value as RecipeFilters['sources'][number])
  }

  const filters: RecipeFilters = {
    q,
    tags: terms('tag', 'tag'),
    ingredients: terms('ingredient', 'ingredient'),
    maxTime: count('maxTime', 'maxTime', LIMITS.totalTime),
    minPortions: count('minPortions', 'minPortions', 1000),
    maxPortions: count('maxPortions', 'maxPortions', 1000),
    sources,
  }
  return { filters, problems }
}

/**
 * The query string for a set of filters, with nothing for a filter that is
 * not set — so no filters is no query at all, and the address is /recipes.
 * Keys in a fixed order, so one set of filters is always one string.
 */
export function filtersToQuery(filters: RecipeFilters): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  if (filters.q) query.q = filters.q
  if (filters.tags.length) query.tag = filters.tags
  if (filters.ingredients.length) query.ingredient = filters.ingredients
  if (filters.maxTime !== null) query.maxTime = String(filters.maxTime)
  if (filters.minPortions !== null) query.minPortions = String(filters.minPortions)
  if (filters.maxPortions !== null) query.maxPortions = String(filters.maxPortions)
  if (filters.sources.length) query.source = filters.sources
  return query
}

export const hasFilters = (filters: RecipeFilters) => Object.keys(filtersToQuery(filters)).length > 0

// How many filters are set, for the badge on the filter button. The search
// has a field of its own and is not counted.
export const filterCount = (filters: RecipeFilters) =>
  filters.tags.length + filters.ingredients.length + filters.sources.length
  + (filters.maxTime !== null ? 1 : 0)
  + (filters.minPortions !== null || filters.maxPortions !== null ? 1 : 0)
