// Strips Markdown emphasis from the steps of recipes already imported from a
// website (#215). New imports have it stripped by the fetcher, with the same
// three patterns as `strip_emphasis` in
// services/recipeat-fetcher/src/recipeat_fetcher/routers/fetch.py.
//
//   node --env-file=.env --experimental-strip-types scripts/strip-step-emphasis.ts           # reports
//   node --env-file=.env --experimental-strip-types scripts/strip-step-emphasis.ts --apply   # writes
//
// Run by hand, once; running it again finds nothing. A step's measurements
// stay where they are: its text parts are joined around them, stripped, and
// split back. `updated_at` is left alone, since no cook changed anything.

import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import type { Step } from '../shared/types/recipe.ts'

// A pair only, opening on a word and closing on one, so the lone `*` of
// "5 * 2" or a footnote mark stays.
const EMPHASIS = [
  /\*\*(?=\S)(.+?)(?<=\S)\*\*/g,
  /(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g,
  /(?<![*\w])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?![*\w])/g,
]

export const stripEmphasis = (text: string) =>
  EMPHASIS.reduce((stripped, pattern) => stripped.replace(pattern, '$1'), text)

// Stands in for a part that isn't text while the text around it is stripped.
const HOLE = ''

export function stripStep(step: Step): Step {
  const others = step.parts.filter(part => part.type !== 'text')
  const joined = step.parts.map(part => (part.type === 'text' ? part.value : HOLE)).join('')
  const texts = stripEmphasis(joined).split(HOLE)
  // A pair across a measurement opens in one part and closes in another, so
  // the split comes back with as many holes as went in.
  const parts = texts.flatMap((value, i) => [
    ...(value ? [{ type: 'text' as const, value }] : []),
    ...(i < others.length ? [others[i]!] : []),
  ])
  return { ...step, originalText: stripEmphasis(step.originalText), parts }
}

// Website imports only: a pasted or photographed step may mean its `*`, and an
// Instagram caption did not come through the scraper.
export async function stripStoredSteps(sql: Sql, { apply }: { apply: boolean }): Promise<string[]> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string, steps: Step[] }[]>`
      SELECT id, steps FROM recipes
      WHERE source->>'type' = 'website' AND source->'post' IS NULL
        AND steps::text ~ '[*]|__'
      FOR UPDATE
    `
    const changed = rows
      .map(row => ({ id: row.id, before: row.steps, steps: row.steps.map(stripStep) }))
      .filter(row => JSON.stringify(row.steps) !== JSON.stringify(row.before))
    if (apply && changed.length) {
      await tx`ALTER TABLE recipes DISABLE TRIGGER recipes_touch_updated_at`
      for (const row of changed) await tx`UPDATE recipes SET steps = ${tx.json(row.steps)} WHERE id = ${row.id}`
      await tx`ALTER TABLE recipes ENABLE TRIGGER recipes_touch_updated_at`
    }
    return changed.map(row => row.id)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply')
  const sql = postgres(process.env.NUXT_DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const ids = await stripStoredSteps(sql, { apply })
    console.log(`${ids.length} recipe(s) ${apply ? 'cleaned' : 'would be cleaned; run with --apply to write'}`)
    for (const id of ids) console.log(`  ${id}`)
  } finally {
    await sql.end()
  }
}
