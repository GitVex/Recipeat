// Measures #159's search terms on #132's 408 hand-matched entries (ad28389):
// how often the matched FoodData Central description shares a term or the
// head. Each entry's first name in a language goes in, ten names a call,
// about what one recipe misses. English and German names are the seed's;
// Spanish, French, Arabic and Korean are search-terms.names.json, one name an
// entry, written by Claude and not checked by a native speaker.
//
//   node --experimental-strip-types scripts/search-terms.ts [model] [url] [seed.json] [en,de,es,fr,ar,ko]
//
// Without seed.json the seed is read from git. Prints a line per call, so a
// run cut short still shows how far it got.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { normalizeName } from '../server/ingredients/normalize.ts'
import { searchTerms, type SearchTerms } from '../server/ingredients/terms.ts'

const [model = 'qwen3.5:4b', url = 'http://127.0.0.1:8101', seed, langs = 'en,de'] = process.argv.slice(2)
type Entry = { key: string, fdcId: number | null, fdc: string } & Record<string, string[]>
const entries = (JSON.parse(seed ? readFileSync(seed, 'utf8') : execSync('git show ad28389:server/extraction/ingredients.json', { encoding: 'utf8', maxBuffer: 1 << 24 })) as Entry[])
  .filter(e => e.fdcId)
const { _: columns, ...more } = JSON.parse(readFileSync(new URL('./search-terms.names.json', import.meta.url), 'utf8')) as Record<string, string[]>
for (const e of entries) columns!.forEach((lang, i) => { const name = more[e.key]?.[i]; e[lang] = name ? [name] : [] })

const words = (text: string) => (normalizeName(text, 'en') ?? '').split(' ')
// A term matches when every word of it is in the description, plurals folded.
const shares = (description: string, term: string) => {
  const have = new Set(words(description))
  return words(term).every(w => have.has(w))
}

for (const lang of langs.split(',')) {
  const cases = entries.filter(e => e[lang]?.[0]).map(e => ({ name: e[lang][0]!, fdc: e.fdc }))
  let term = 0, head = 0, either = 0, ms = 0
  const misses: string[] = []
  for (let i = 0; i < cases.length; i += 10) {
    const batch = cases.slice(i, i + 10)
    const start = performance.now()
    let out: SearchTerms[]
    try {
      out = await searchTerms(batch.map(c => c.name), lang, { ollamaBaseUrl: url, ollamaModel: model, ollamaThreads: 4 })
    } catch (error) {
      console.error(lang, i, (error as Error).message)
      continue
    }
    ms += performance.now() - start
    batch.forEach((c, j) => {
      const t = out[j]!.terms.some(x => shares(c.fdc, x)), h = shares(c.fdc, out[j]!.head)
      term += +t; head += +h; either += +(t || h)
      if (!t && !h) misses.push(`${c.name} → ${out[j]!.terms.join(' | ')} / ${out[j]!.head}  ≠  ${c.fdc}`)
    })
    console.log(`${lang} ${i + batch.length}/${cases.length}: either ${either}, ${((performance.now() - start) / 1000).toFixed(1)}s`)
  }
  const pct = (n: number) => `${(100 * n / cases.length).toFixed(1)}%`
  console.log(`\n${model} ${lang}: ${cases.length} names, term ${pct(term)}, head ${pct(head)}, either ${pct(either)}, ${(ms / Math.ceil(cases.length / 10) / 1000).toFixed(1)}s a call`)
  console.log(misses.slice(0, 25).join('\n'))
}
