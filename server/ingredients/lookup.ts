import type { Sql, TransactionSql } from 'postgres'
import { searchWeb, type SearchConfig } from '../recipes/similar.ts'
import type { SimilarRecipe } from '../../shared/types/recipe.ts'
import { primaryLanguage } from './match.ts'

// Names in other languages and a density for an entry a cook made (#174):
// names from Wikidata, density from a SearXNG web search. Nothing records
// that a lookup ran; an entry missing either is tried again on a schedule
// worked out from its created_at, for a week, and then left to cooks (#155).

export type LookupConfig = SearchConfig & { ingredientLookupBaseMinutes: number }
type Fetch = typeof globalThis.fetch

const WINDOW = '7 days'
const WIKIDATA = 'https://www.wikidata.org/w/api.php'
// Wikimedia asks every client to say who it is.
const HEADERS = { 'User-Agent': 'Recipeat (https://github.com/GitVex/Recipeat)' }
const TIMEOUT_MS = 8_000
// What a density has to be to be believed: lighter than puffed rice is a
// bulk figure gone wrong, heavier than honey's double is no food.
const MIN = 0.1
const MAX = 2.5
const ML_PER_CUP = 236.588

// "0.32 g/mL", "1,03 g per ml", "0.92 g/cm³", "1.1 kg/L"
const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`
const PER_ML = new RegExp(String.raw`${NUMBER}\s*(?:(?:g|grams?)\s*(?:\/|per)\s*(?:ml|millilit(?:er|re)s?|cm3|cm³|cc)|kg\s*(?:\/|per)\s*(?:l|lit(?:er|re)s?))(?![a-z])`, 'gi')
// "120 g per cup", "125 grams in a cup", and "1 cup = 125 g"
const PER_CUP = new RegExp(String.raw`${NUMBER}\s*(?:g|grams?)\s*(?:\/|per|in|to)\s*(?:a\s+|one\s+|1\s+)?(?:US\s+)?cups?\b`, 'gi')
const CUP_IS = new RegExp(String.raw`\b(?:1|one|a)\s+(?:US\s+)?cup\b[^\d]{0,30}?${NUMBER}\s*(?:g|grams?)\b`, 'gi')

/** The first figure in g/ml or g per cup in a snippet that is a believable density, in g/ml. */
export function densityIn(snippet: string): number | null {
  const found = [
    ...[...snippet.matchAll(PER_ML)].map(match => ({ at: match.index, value: Number(match[1]!.replace(',', '.')) })),
    ...[...snippet.matchAll(PER_CUP), ...snippet.matchAll(CUP_IS)].map(match => ({ at: match.index, value: Number(match[1]!.replace(',', '.')) / ML_PER_CUP })),
  ].sort((a, b) => a.at - b.at)
  const density = found.find(({ value }) => value >= MIN && value <= MAX)?.value
  return density === undefined ? null : Math.round(density * 1000) / 1000
}

/** The first result with a density in its snippet, and that density. */
export function densityFrom(results: SimilarRecipe[]): { value: number, url: string } | null {
  for (const result of results) {
    const value = densityIn(`${result.title} ${result.snippet}`)
    if (value !== null) return { value, url: result.url }
  }
  return null
}

/** An item's labels, one per language by primary subtag, first one kept. */
export function labelsOf(payload: unknown, id: string): { lang: string, name: string }[] {
  const labels = (payload as { entities?: Record<string, { labels?: Record<string, { language?: unknown, value?: unknown }> }> } | null)
    ?.entities?.[id]?.labels ?? {}
  const names = new Map<string, string>()
  for (const { language, value } of Object.values(labels)) {
    if (typeof language !== 'string' || typeof value !== 'string' || !value.trim()) continue
    const lang = primaryLanguage(language)
    // 'mul' is every language's, and the store says that with 'xx' only for
    // the seed; odd codes aren't languages a recipe is in.
    if (lang === 'mul' || !/^[a-z]{2,3}$/.test(lang) || names.has(lang)) continue
    names.set(lang, value.trim())
  }
  return [...names].map(([lang, name]) => ({ lang, name }))
}

async function wikidata(params: Record<string, string>, fetcher: Fetch): Promise<unknown> {
  const url = new URL(WIKIDATA)
  url.search = new URLSearchParams({ ...params, format: 'json' }).toString()
  const response = await fetcher(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`)
  return response.json()
}

/** The names of the first Wikidata item found for `name`; none when nothing is. */
export async function wikidataNames(name: string, lang: string, fetcher: Fetch = globalThis.fetch) {
  const search = await wikidata({ action: 'wbsearchentities', search: name, language: lang, uselang: lang, type: 'item', limit: '1' }, fetcher) as { search?: { id?: unknown }[] }
  const id = search.search?.[0]?.id
  if (typeof id !== 'string') return []
  return labelsOf(await wikidata({ action: 'wbgetentities', ids: id, props: 'labels' }, fetcher), id)
}

type Due = { id: string, lang: string, name: string, needs_density: boolean, needs_names: boolean }

/**
 * Looks up every entry with a try due since `since`, one transaction each,
 * and answers the database's time it went by, for the next call's `since`.
 * Try 0 is the entry's creation, try k at created_at + base·k².
 */
export async function lookUpDue(sql: Sql, since: Date, config: LookupConfig, fetcher: Fetch = globalThis.fetch): Promise<Date> {
  const [{ now }] = await sql<{ now: Date }[]>`SELECT now()`
  const base = config.ingredientLookupBaseMinutes * 60
  const done: string[] = []
  for (;;) {
    const more = await sql.begin(async (tx) => {
      // NO KEY UPDATE: a line being linked to the entry meanwhile only needs
      // the key, so matching isn't held up by a slow lookup.
      const [entry] = await tx<Due[]>`
        SELECT i.id, main.lang, main.name,
               i.density_g_per_ml IS NULL AS needs_density,
               NOT EXISTS (SELECT 1 FROM ingredient_names s WHERE s.ingredient_id = i.id AND s.source = 'wikidata') AS needs_names
        FROM ingredients i
        CROSS JOIN LATERAL (
          SELECT lang, name FROM ingredient_names
          WHERE ingredient_id = i.id AND is_main AND source = 'cook' ORDER BY created_at LIMIT 1
        ) main
        WHERE i.created_by IS NOT NULL AND i.created_at > ${now}::timestamptz - ${WINDOW}::interval
          AND NOT (i.id = ANY(${done}::bigint[]))
          AND (i.density_g_per_ml IS NULL
               OR NOT EXISTS (SELECT 1 FROM ingredient_names s WHERE s.ingredient_id = i.id AND s.source = 'wikidata'))
          AND (i.created_at > ${since}
               OR floor(sqrt(extract(epoch FROM ${now}::timestamptz - i.created_at) / ${base}))
                > floor(sqrt(extract(epoch FROM ${since}::timestamptz - i.created_at) / ${base})))
        ORDER BY i.created_at LIMIT 1
        FOR NO KEY UPDATE OF i SKIP LOCKED`
      if (!entry) return false
      done.push(entry.id)
      await lookUp(tx, entry, config, fetcher)
      return true
    })
    if (!more) return now
  }
}

// Each source on its own: one being down leaves only its part missing, for
// a later try.
async function lookUp(tx: TransactionSql, entry: Due, config: LookupConfig, fetcher: Fetch) {
  if (entry.needs_names) {
    try {
      const names = await wikidataNames(entry.name, entry.lang, fetcher)
      // Unconfirmed: a close-match candidate, never an exact match, until a
      // cook picks one (#173). A name its language already has is skipped.
      if (names.length) {
        await tx`
          INSERT INTO ingredient_names ${tx(names.map(({ lang, name }) => ({
            ingredient_id: entry.id, lang, name, is_main: false, confirmed: false, source: 'wikidata', added_by: null,
          })))}
          ON CONFLICT DO NOTHING`
      }
    } catch (error) {
      console.warn(`[ingredients] no names for ${entry.id} this time`, (error as Error).message)
    }
  }
  if (entry.needs_density) {
    try {
      const found = densityFrom(await searchWeb(`${entry.name} density g/ml`, 'all', config, fetcher))
      if (found) {
        await tx`
          UPDATE ingredients SET density_g_per_ml = ${found.value}, density_source = 'searxng', density_ref = ${found.url}
          WHERE id = ${entry.id}`
      }
    } catch (error) {
      console.warn(`[ingredients] no density for ${entry.id} this time`, (error as Error).message)
    }
  }
}
