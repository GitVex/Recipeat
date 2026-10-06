// A dedicated translation model on #132's 408 entries, scored like
// search-terms.ts with its English as the only term (no synonyms, no head).
// With "qwen", the English also goes to qwen3.5:4b as `en`, ten names a
// call, scored with terms and head, which takes ~16 minutes a language on
// the VPS. Translations are written to scripts/translations/<model>.json.
//
//   node --experimental-strip-types scripts/translate-terms.ts <model> <gemma|hy> [url] [de,es,fr,ar,ko] [qwen]
//
// gemma: translategemma's prompt; hy: Tencent HY-MT's. Models measured:
// translategemma:4b, MedAIBase/Tencent-HY-MT1.5:1.8b and :7b.

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { normalizeName } from '../server/ingredients/normalize.ts'
import { searchTerms } from '../server/ingredients/terms.ts'

const [model, style, url = 'http://127.0.0.1:8101', langs = 'de,es,fr,ar,ko', withQwen] = process.argv.slice(2)
if (!model || (style !== 'gemma' && style !== 'hy')) throw new Error('usage: translate-terms.ts <model> <gemma|hy> [url] [langs] [qwen]')
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
const LANGUAGES: Record<string, string> = { de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic', ko: 'Korean' }

const prompt = (lang: string, text: string) => style === 'gemma'
  ? `You are a professional ${LANGUAGES[lang]} (${lang}) to English (en) translator. Your goal is to accurately convey the meaning and nuances of the original ${LANGUAGES[lang]} text while adhering to English grammar, vocabulary, and cultural sensitivities.\nProduce only the English translation, without any additional explanations or commentary. Please translate the following ${LANGUAGES[lang]} text into English:\n\n\n${text}`
  : `Translate the following segment into English, without additional explanation.\n\n${text}`

async function translate(lang: string, text: string) {
  const response = await fetch(`${url}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model, stream: false, think: false,
      options: { temperature: 0, num_thread: 4, num_predict: 32 },
      messages: [{ role: 'user', content: prompt(lang, text) }],
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return ((await response.json()).message.content as string).trim().split('\n')[0]!.replace(/[.。]$/, '').toLowerCase()
}

const file = new URL(`./translations/${model.replace(/\W/g, '_')}.json`, import.meta.url)
const out: Record<string, { name: string, en: string, fdc: string }[]> = {}
for (const lang of langs.split(',')) {
  const cases = entries.filter(e => e[lang]?.[0]).map(e => ({ name: e[lang][0]!, fdc: e.fdc }))
  const rows: typeof out[string] = []
  const start = performance.now()
  for (const c of cases) {
    const en = await translate(lang, c.name).catch((error) => { console.error(c.name, (error as Error).message); return '' })
    rows.push({ ...c, en })
  }
  const perName = (performance.now() - start) / 1000 / cases.length
  out[lang] = rows
  mkdirSync(new URL('./translations/', import.meta.url), { recursive: true })
  writeFileSync(file, JSON.stringify(out, null, 1))
  const pct = (n: number) => `${(100 * n / cases.length).toFixed(1)}%`
  console.log(`\n${model} ${lang}: ${cases.length} names, translation alone ${pct(rows.filter(r => r.en && shares(r.fdc, r.en)).length)}, ${perName.toFixed(2)}s a name`)
  if (withQwen !== 'qwen') continue

  let either = 0, failed = 0
  const misses: string[] = []
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10)
    try {
      const res = await searchTerms(batch.map(r => r.en || r.name), 'en', { ollamaBaseUrl: url, ollamaModel: 'qwen3.5:4b', ollamaThreads: 4 })
      batch.forEach((r, j) => {
        const hit = res[j]!.terms.some(t => shares(r.fdc, t)) || shares(r.fdc, res[j]!.head)
        either += +hit
        if (!hit) misses.push(`${r.name} → ${r.en} → ${res[j]!.terms.join(' | ')} / ${res[j]!.head}  ≠  ${r.fdc}`)
      })
    } catch (error) {
      failed++
      console.error(lang, i, (error as Error).message)
    }
  }
  console.log(`${model} → qwen3.5:4b ${lang}: ${pct(either)} (${failed} failed calls, their names counted as misses)`)
  console.log(misses.slice(0, 15).join('\n'))
}
