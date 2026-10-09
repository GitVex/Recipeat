import type { Sql, TransactionSql } from 'postgres'
import type { Ingredient } from '../../shared/types/recipe.ts'

// Matching a recipe's lines against the ingredient store (#172), one queued
// recipe per transaction. See 007_ingredient_matching.sql for the tables and
// #170 for what each kind of match means.

// pg_trgm similarity a close match needs.
export const CLOSE = 0.4
const CANDIDATES = 3
// How long a recipe whose pass failed waits before it is tried again.
const RETRY_AFTER = '5 minutes'

// The opt-in, #173's preference. Anything else, or no row, is opted out.
export const OPT_IN = { key: 'ingredientMatching', value: 'on' }
// Told the recipe's id once a pass or an answer has changed its lines'
// links or questions; the recipe page listens (#173).
export const MATCHED = 'ingredient_matched'

/**
 * Claims the next queued recipe, matches its lines and takes it off the
 * queue, all in one transaction. False means there was nothing to claim. A
 * pass that fails leaves the recipe queued, held back for a while, and throws.
 */
export async function matchNext(sql: Sql): Promise<boolean> {
  let claimed: string | undefined
  try {
    return await sql.begin(async (tx) => {
      const [job] = await tx<{ recipe_id: string }[]>`
        DELETE FROM ingredient_queue WHERE recipe_id = (
          SELECT recipe_id FROM ingredient_queue WHERE not_before <= now()
          ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED
        ) RETURNING recipe_id`
      if (!job) return false
      claimed = job.recipe_id
      await matchRecipe(tx, job.recipe_id)
      return true
    })
  } catch (error) {
    if (claimed) await sql`UPDATE ingredient_queue SET not_before = now() + ${RETRY_AFTER}::interval WHERE recipe_id = ${claimed}`.catch(() => {})
    throw error
  }
}

/** Claims and matches until the queue has nothing ready. */
export async function drainQueue(sql: Sql): Promise<void> {
  while (await matchNext(sql));
}

// `de-DE` → `de`. 'und' stays 'und', and matches every language.
export const primaryLanguage = (tag: string) => tag.split(/[-_]/)[0]!.toLowerCase()

async function matchRecipe(tx: TransactionSql, recipeId: string) {
  const [recipe] = await tx<{ owner_sub: string, source_lang: string, ingredients: Ingredient[], opted_in: boolean }[]>`
    SELECT r.owner_sub, r.source_lang, r.ingredients,
           coalesce(p.settings->>${OPT_IN.key} = ${OPT_IN.value}, false) AS opted_in
    FROM recipes r LEFT JOIN preferences p ON p.owner_sub = r.owner_sub
    WHERE r.id = ${recipeId}`
  // Deleted since it was queued; the foreign keys took the rest.
  if (!recipe) return

  const lines = recipe.ingredients
    .map(line => ({ id: line.id, name: line.name.trim() }))
    .filter(line => line.name)
  const ids = lines.map(line => line.id)
  const names = lines.map(line => line.name)

  // Whatever no longer fits the recipe as it is now: a line removed, or
  // renamed under the same id.
  for (const table of ['ingredient_links', 'ingredient_candidates']) {
    await tx`
      DELETE FROM ${tx(table)} WHERE recipe_id = ${recipeId}
        AND (line_id, name) NOT IN (SELECT * FROM unnest(${ids}::text[], ${names}::text[]))`
  }
  const linked = new Set((await tx<{ line_id: string }[]>`
    SELECT line_id FROM ingredient_links WHERE recipe_id = ${recipeId}`).map(row => row.line_id))

  const lang = primaryLanguage(recipe.source_lang)
  await closeThreshold(tx)

  const link = (lineId: string, name: string, ingredientId: string) =>
    linkLine(tx, recipeId, recipe.owner_sub, lineId, name, ingredientId)

  for (const line of lines) {
    if (linked.has(line.id)) continue

    const exact = await exactMatches(tx, line.name, lang)
    if (exact.length === 1) {
      await link(line.id, line.name, exact[0]!.ingredient_id)
      continue
    }
    // Two entries share the name across the languages searched: not
    // unambiguous, so it is a question rather than a link.
    if (!recipe.opted_in) continue

    const close = await closeMatches(tx, line.name, lang)
    await tx`DELETE FROM ingredient_candidates WHERE recipe_id = ${recipeId} AND line_id = ${line.id}`
    if (close.length) {
      await tx`INSERT INTO ingredient_candidates ${tx(close.map(candidate => ({
        recipe_id: recipeId, owner_sub: recipe.owner_sub, line_id: line.id, name: line.name, ...candidate,
      })))}`
      continue
    }
    // Nothing near it: a new entry under the cook's name. Not for an 'und'
    // recipe, whose name has no language to be filed under.
    if (lang === 'und') continue
    await link(line.id, line.name, await createEntry(tx, recipe.owner_sub, lang, line.name))
  }
  await tx`SELECT pg_notify(${MATCHED}, ${recipeId})`
}

// An 'und' recipe is matched against every language; any other against its
// own, and the names OFF gives every language ('xx').
const inLanguage = (tx: TransactionSql, lang: string) => lang === 'und' ? tx`true` : tx`lang IN (${lang}, 'xx')`

// The operator closeMatches uses finds what the index can; the threshold sits
// a hair under CLOSE so the explicit comparison decides the boundary. For the
// rest of the transaction.
const closeThreshold = (tx: TransactionSql) =>
  tx`SELECT set_config('pg_trgm.similarity_threshold', ${String(CLOSE - 0.01)}, true)`

// The entries whose confirmed name a line's name is. One is a link; more is
// ambiguous, and asked like a close match.
const exactMatches = (tx: TransactionSql, name: string, lang: string) => tx<{ ingredient_id: string }[]>`
  SELECT DISTINCT ingredient_id FROM ingredient_names
  WHERE confirmed AND lower(name) = lower(${name}) AND ${inLanguage(tx, lang)}`

// The entries a line comes close to, best first: what its owner is asked.
// Needs closeThreshold earlier in the transaction.
const closeMatches = (tx: TransactionSql, name: string, lang: string) => tx<{ ingredient_id: string, matched_name: string, similarity: number }[]>`
  SELECT ingredient_id, matched_name, similarity FROM (
    SELECT DISTINCT ON (ingredient_id) ingredient_id, name AS matched_name,
           public.similarity(lower(name), lower(${name})) AS similarity
    FROM ingredient_names
    WHERE lower(name) OPERATOR(public.%) lower(${name}) AND ${inLanguage(tx, lang)}
    ORDER BY ingredient_id, similarity DESC, is_main DESC, name
  ) best
  WHERE similarity >= ${CLOSE}
  ORDER BY similarity DESC, ingredient_id
  LIMIT ${CANDIDATES}`

/**
 * How many of a cook's lines a pass would ask about if they opted in (#180):
 * the opt-in dialog's count. The same steps as matchRecipe for an opted-in
 * owner, without writing anything. A question stored from an earlier opt-in
 * is counted when the pass would still ask it.
 */
export async function previewQuestions(sql: Sql, ownerSub: string): Promise<number> {
  return sql.begin('read only', async (tx) => {
    await closeThreshold(tx)
    const lines = await tx<{ name: string, lang: string }[]>`
      SELECT trim(line.value->>'name') AS name, r.source_lang AS lang
      FROM recipes r CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) AS line(value)
      WHERE r.owner_sub = ${ownerSub} AND trim(line.value->>'name') <> ''
        AND NOT EXISTS (SELECT 1 FROM ingredient_links l
                        WHERE l.recipe_id = r.id AND l.line_id = line.value->>'id' AND l.name = trim(line.value->>'name'))`
    // ponytail: two queries a line, fine for a household's recipes; one
    // set-based query if a cook with thousands makes the spinner linger.
    let asked = 0
    for (const line of lines) {
      const lang = primaryLanguage(line.lang)
      if ((await exactMatches(tx, line.name, lang)).length === 1) continue
      if ((await closeMatches(tx, line.name, lang)).length) asked++
    }
    return asked
  })
}

/** Links a line to an entry, which settles its question. */
export async function linkLine(tx: TransactionSql, recipeId: string, ownerSub: string, lineId: string, name: string, ingredientId: string) {
  await tx`
    INSERT INTO ingredient_links (recipe_id, owner_sub, line_id, name, ingredient_id)
    VALUES (${recipeId}, ${ownerSub}, ${lineId}, ${name}, ${ingredientId})
    ON CONFLICT (recipe_id, line_id) DO UPDATE SET name = EXCLUDED.name, ingredient_id = EXCLUDED.ingredient_id, linked_at = now()`
  await tx`DELETE FROM ingredient_candidates WHERE recipe_id = ${recipeId} AND line_id = ${lineId}`
}

// A new entry with `name` as its main name. Another pass creating the same
// name at the same moment waits on the unique index and then finds nothing to
// insert; this one's entry is dropped and the line takes theirs.
export async function createEntry(tx: TransactionSql, ownerSub: string, lang: string, name: string): Promise<string> {
  const [{ id }] = await tx<{ id: string }[]>`INSERT INTO ingredients (created_by) VALUES (${ownerSub}) RETURNING id`
  const [named] = await tx`
    INSERT INTO ingredient_names (ingredient_id, lang, name, is_main, confirmed, source, added_by)
    VALUES (${id}, ${lang}, ${name}, true, true, 'cook', ${ownerSub})
    ON CONFLICT DO NOTHING RETURNING ingredient_id`
  if (named) return id
  await tx`DELETE FROM ingredients WHERE id = ${id}`
  const [{ ingredient_id }] = await tx<{ ingredient_id: string }[]>`
    SELECT ingredient_id FROM ingredient_names WHERE lang = ${lang} AND lower(name) = lower(${name})`
  return ingredient_id
}
