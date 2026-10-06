// Open Food Facts' ingredients taxonomy and Mealie's food seed as lookups on
// #132's 408 hand-matched entries (ad28389), scored like search-terms.ts: a
// name is looked up exactly after #157's normalization, and counts when the
// FDC description contains every word of the entry's English. For OFF also:
// how often the entry's usda_fdc_code is ours. Both are fetched at pinned
// revisions; Mealie's is AGPL-3.0 and is only read here, never stored.
//
//   node --experimental-strip-types scripts/lookups.ts

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { normalizeName } from '../server/ingredients/normalize.ts'

const OFF = 'https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/v2.112.0/taxonomies/food/ingredients.txt'
const MEALIE = 'https://raw.githubusercontent.com/mealie-recipes/mealie/3338ba8d207d8d2fb7ec90d94bb4b7f001018569/mealie/repos/seed/resources/foods/locales'
const LOCALES: Record<string, string> = { en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA', ko: 'ko-KR' }

type Entry = { key: string, fdcId: number | null, fdc: string } & Record<string, string[]>
const entries = (JSON.parse(execSync('git show ad28389:server/extraction/ingredients.json', { encoding: 'utf8', maxBuffer: 1 << 24 })) as Entry[])
  .filter(e => e.fdcId)
const { _: columns, ...more } = JSON.parse(readFileSync(new URL('./search-terms.names.json', import.meta.url), 'utf8')) as Record<string, string[]>
for (const e of entries) columns!.forEach((lang, i) => { const name = more[e.key]?.[i]; e[lang] = name ? [name] : [] })

const words = (text: string) => (normalizeName(text, 'en') ?? '').split(' ')
const shares = (description: string, term: string) => {
  const have = new Set(words(description))
  return words(term).every(w => have.has(w))
}
const get = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

// OFF: blocks separated by blank lines; "lang: name, synonym, …" lines, and
// "usda_fdc_code:en: 171426". Names stay per language; the first entry to
// claim a normalized name keeps it (a seed would skip such names instead).
type Node = { names: Record<string, string[]>, fdc?: number }
const off: Record<string, Map<string, Node>> = {}
for (const block of (await get(OFF)).split(/\n\s*\n/)) {
  const node: Node = { names: {} }
  for (const line of block.split('\n')) {
    let m
    if (line.startsWith('#') || /^(synonyms|stopwords):/.test(line)) continue
    if ((m = line.match(/^usda_fdc_code:en:\s*(\d+)/))) node.fdc = +m[1]!
    else if ((m = line.match(/^([a-z]{2,3}):\s*(.+)$/))) node.names[m[1]!] = m[2]!.split(',').map(s => s.trim()).filter(Boolean)
  }
  for (const [lang, list] of Object.entries(node.names)) for (const name of list) {
    const k = normalizeName(name, lang)
    if (k && !(off[lang] ??= new Map()).has(k)) off[lang]!.set(k, node)
  }
}

// Mealie: { category: { foods: { "english key": { name, plural_name } } } }.
const mealie: Record<string, Map<string, string>> = {}
for (const [lang, locale] of Object.entries(LOCALES)) {
  const seed = JSON.parse(await get(`${MEALIE}/${locale}.json`)) as Record<string, { foods: Record<string, { name: string, plural_name: string }> }>
  const index = mealie[lang] = new Map()
  for (const category of Object.values(seed)) for (const [key, food] of Object.entries(category.foods))
    for (const name of [food.name, food.plural_name]) { const k = name && normalizeName(name, lang); if (k && !index.has(k)) index.set(k, key) }
}

for (const lang of Object.keys(LOCALES)) {
  const cases = entries.filter(e => e[lang]?.[0])
  let offFound = 0, offHit = 0, offFdc = 0, offOurs = 0, mealieHit = 0, either = 0
  for (const e of cases) {
    const name = normalizeName(e[lang][0]!, lang) ?? ''
    const node = off[lang]?.get(name), key = mealie[lang]?.get(name)
    const a = !!node && (node.names.en ?? []).some(t => shares(e.fdc, t)), b = !!key && shares(e.fdc, key)
    offFound += +!!node; offHit += +a; mealieHit += +b; either += +(a || b)
    if (node?.fdc) { offFdc++; offOurs += +(node.fdc === e.fdcId) }
  }
  const pct = (n: number) => `${(100 * n / cases.length).toFixed(1)}%`
  console.log(`${lang}: ${cases.length} names, OFF found ${pct(offFound)}, OFF ${pct(offHit)} (FDC id given for ${offFdc}, ours ${offOurs}), Mealie ${pct(mealieHit)}, either ${pct(either)}`)
}
