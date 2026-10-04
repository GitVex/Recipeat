import type { Sql } from 'postgres'
import { matchFood, setFoods } from '../extraction/ingredients.ts'
import { renormalize } from '../recipes/renormalize.ts'
import { fdcMatch } from './fdc.ts'
import type { Community } from './community.ts'
import { readFoods } from './store.ts'

// Held by every resolver run for its transaction, in the app and from npm
// alike, so two runs never learn one name twice. 8100_01 is the migrations'.
const LOCK_KEY = 8100_02

// The snapshot last loaded, to tell whether a reload changed anything.
let loaded = ''

/** Reads the table into the matcher's snapshot. True when it differs from the last one. */
export async function loadFoods(sql: Sql, community: Community): Promise<boolean> {
  const foods = await readFoods(sql, community.aliasCooks)
  setFoods(foods)
  const json = JSON.stringify(foods)
  const changed = json !== loaded
  loaded = json
  return changed
}

// A learned key is its name, as far as a key may spell it.
const slug = (name: string) => name.replace(/ /g, '_').replace(/[^a-z0-9_]/g, '') || 'ingredient'

/**
 * Makes a key of every name enough cooks have used, unless it matches now or
 * the votes lean towards it being an existing key (#133). The new key has the
 * name in each language it was sighted in, no form, and a density only from
 * one clear FoodData Central hit. Answers with the keys it made, and whether
 * the table had changed before it did.
 */
async function learnKeys(sql: Sql, community: Community): Promise<{ learned: string[], changed: boolean }> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`
    // Read under the lock, so a name another run has just learned matches.
    // A run from npm, or votes that made an alias, change the table without
    // this process knowing; this reload is what tells it.
    const changed = await loadFoods(tx, community)
    const candidates = await tx<{ name: string, langs: ('en' | 'de')[] }[]>`
      SELECT c.name, c.langs FROM ingredient_sighting_counts c
      WHERE c.cooks >= ${community.keyCooks}
        AND NOT EXISTS (SELECT 1 FROM ingredient_alias_counts a WHERE a.name = c.name AND a.chosen > a.rejected)
      ORDER BY c.name
    `
    const keys = new Set((await tx<{ key: string }[]>`SELECT key FROM ingredients`).map(row => row.key))
    const learned: string[] = []
    for (const { name, langs } of candidates) {
      // Sightings are kept, so a name learned or aliased since is still counted.
      if (langs.some(lang => matchFood(name, lang))) continue
      let key = slug(name)
      for (let n = 2; keys.has(key); n++) key = `${slug(name)}_${n}`
      keys.add(key)
      const hit = await fdcMatch(tx, name)
      await tx`
        INSERT INTO ingredients (key, fdc_id, fdc, portion, grams_per_ml, learned_at)
        VALUES (${key}, ${hit?.fdcId ?? null}, ${hit?.fdc ?? null}, ${hit?.portion ?? null}, ${hit?.gramsPerMl ?? null}, now())
      `
      await tx`INSERT INTO ingredient_names ${tx(langs.map(lang => ({ name, lang, key, position: 0 })))}`
      learned.push(key)
    }
    return { learned, changed }
  })
}

/**
 * One run of the resolver: learns keys, reloads the snapshot, and when the
 * table changed, re-normalizes the stored recipes it changes. Run every ten
 * minutes by the app and on demand by `npm run ingredients:resolve`.
 */
export async function resolve(sql: Sql, community: Community): Promise<{ learned: string[], changed: boolean, renormalized: number }> {
  const { learned, changed } = await learnKeys(sql, community)
  if (learned.length) {
    console.info(`[ingredients] learned ${learned.join(', ')}`)
    await loadFoods(sql, community)
  }
  if (!changed && !learned.length) return { learned, changed: false, renormalized: 0 }
  const renormalized = await renormalize(sql)
  if (renormalized) console.info(`[ingredients] re-normalized ${renormalized} recipes`)
  return { learned, changed: true, renormalized }
}
