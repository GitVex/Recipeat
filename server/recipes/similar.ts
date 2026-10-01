import { fail } from '../extraction/errors.ts'
import { siteHost } from '../../shared/utils/siteSupport.ts'
import type { SimilarRecipe } from '../../shared/types/recipe.ts'

// "Similar recipes elsewhere" (#59): a web search for the recipe's title,
// through the SearXNG instance in docker/compose.search.yaml. Links out and
// nothing more — no fetcher, no extraction, nothing stored.

export type SearchConfig = { searxngBaseUrl: string }

const SEARCH_TIMEOUT_MS = 8_000
// More than three are kept, so leaving out the recipe's own source still
// leaves three, and the cache serves every recipe with the same title.
const CANDIDATES = 8
const SHOWN = 3

// "carbonara" alone finds Wikipedia. The word is in the recipe's language,
// since the search is too.
const RECIPE_WORD: Record<string, string> = { de: 'Rezept', fr: 'recette', it: 'ricetta', es: 'receta', nl: 'recept' }

export function searchQuery(title: string, lang: string): string {
  return `${title} ${RECIPE_WORD[lang] ?? 'recipe'}`
}

/** The candidates in a SearXNG JSON answer: http(s) links with a title, once each. */
export function candidates(payload: unknown): SimilarRecipe[] {
  const results = (payload as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) throw fail(502, 'The search returned a malformed answer.', payload)
  const seen = new Set<string>()
  const found: SimilarRecipe[] = []
  for (const result of results) {
    const { url, title, content } = (result ?? {}) as Record<string, unknown>
    if (typeof url !== 'string' || typeof title !== 'string' || !title.trim()) continue
    const site = siteHost(url)
    const key = page(url)
    if (!site || !key || seen.has(key)) continue
    seen.add(key)
    found.push({ title: title.trim(), url, site, snippet: typeof content === 'string' ? content.trim() : '' })
    if (found.length === CANDIDATES) break
  }
  return found
}

/** Three, without the pages the recipe itself came from. */
export function similarTo(found: SimilarRecipe[], sources: (string | null | undefined)[]): SimilarRecipe[] {
  const own = new Set(sources.map(source => source && page(source)).filter(Boolean))
  return found.filter(result => !own.has(page(result.url))).slice(0, SHOWN)
}

// One page whatever the scheme, www., trailing slash or query say.
function page(address: string): string | null {
  const host = siteHost(address)
  return host && `${host}${new URL(address).pathname.replace(/[/]+$/, '')}`
}

export async function searchWeb(
  query: string,
  lang: string,
  config: SearchConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<SimilarRecipe[]> {
  if (!config.searxngBaseUrl) throw fail(503, 'Web search isn’t set up on this server.')
  const url = new URL(`${config.searxngBaseUrl.replace(/[/]+$/, '')}/search`)
  url.search = new URLSearchParams({ q: query, format: 'json', language: lang, categories: 'general' }).toString()
  let payload: unknown
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    payload = await response.json()
  } catch (error) {
    throw fail(502, 'The web search didn’t answer.', error)
  }
  return candidates(payload)
}

// ponytail: per process and per user, forgotten on restart; a shared store if
// the app ever runs more than one instance.
const WINDOW_MS = 60 * 60 * 1000
const PER_WINDOW = 30
const windows = new Map<string, { start: number, count: number }>()

/** Whether this user may search again, counting the search if so. */
export function allowSearch(ownerSub: string, now = Date.now()): boolean {
  let window = windows.get(ownerSub)
  if (!window || now - window.start >= WINDOW_MS) {
    // Expired windows are dropped as they are passed, so the map stays the size
    // of the last hour's searchers.
    for (const [sub, old] of windows) if (now - old.start >= WINDOW_MS) windows.delete(sub)
    window = { start: now, count: 0 }
    windows.set(ownerSub, window)
  }
  return ++window.count <= PER_WINDOW
}
