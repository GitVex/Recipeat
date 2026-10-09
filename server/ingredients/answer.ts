import type { Sql, TransactionSql } from 'postgres'
import type { Ingredient } from '../../shared/types/recipe.ts'
import { WEIGHED } from '../../shared/utils/recipeText.ts'
import { createEntry, linkLine, MATCHED, OPT_IN, primaryLanguage } from './match.ts'

// The owner's answers to a close match (#173): which entry a line is, if
// any. Each goes into the shared store at once and touches only this recipe;
// see #170 for what each answer means. And to a question about a linked
// line's entry (#181): whether it is a liquid, for everyone, first answer
// standing. #155 asks there about weighing it.

export type Answer = 'alias' | 'typo' | 'none' | 'liquid' | 'solid'
export const ANSWERS: readonly Answer[] = ['alias', 'typo', 'none', 'liquid', 'solid']

export type IngredientQuestion =
  | { kind: 'match', lineId: string, name: string, candidates: { ingredientId: string, name: string }[] }
  | { kind: 'about', lineId: string, name: string, ingredientId: string }

type Owned = { source_lang: string, ingredients: Ingredient[], opted_in: boolean }

const owned = (sql: Sql | TransactionSql, ownerSub: string, recipeId: string, lock = false) => sql<Owned[]>`
  SELECT r.source_lang, r.ingredients,
         coalesce(p.settings->>${OPT_IN.key} = ${OPT_IN.value}, false) AS opted_in
  FROM recipes r LEFT JOIN preferences p ON p.owner_sub = r.owner_sub
  WHERE r.id = ${recipeId} AND r.owner_sub = ${ownerSub}
  ${lock ? sql`FOR UPDATE OF r` : sql``}`

// The open questions on a recipe's lines as they are now, in line order;
// a row made for a name the line no longer carries is stale and left out.
const open = (sql: Sql | TransactionSql, recipeId: string) => sql<{ line_id: string, name: string, ingredient_id: string, matched_name: string }[]>`
  SELECT c.line_id, c.name, c.ingredient_id, c.matched_name
  FROM recipes r
  CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) WITH ORDINALITY AS line(value, n)
  JOIN ingredient_candidates c ON c.recipe_id = r.id AND c.line_id = line.value->>'id' AND c.name = trim(line.value->>'name')
  WHERE r.id = ${recipeId}
  ORDER BY line.n, c.similarity DESC, c.ingredient_id`

// Linked lines measured in cups or fluid ounces whose entry has a density
// nobody has said is a liquid or not: converting them leans on the guess.
// Spoons and millilitres convert the same either way. One link a line.
const about = (sql: Sql | TransactionSql, of: { recipeId: string } | { ownerSub: string }) => sql<{ recipe_id: string, line_id: string, name: string, ingredient_id: string }[]>`
  SELECT r.id AS recipe_id, l.line_id, l.name, l.ingredient_id
  FROM recipes r
  CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) WITH ORDINALITY AS line(value, n)
  JOIN ingredient_links l ON l.recipe_id = r.id AND l.line_id = line.value->>'id' AND l.name = trim(line.value->>'name')
  JOIN ingredients i ON i.id = l.ingredient_id
  WHERE ${'recipeId' in of ? sql`r.id = ${of.recipeId}` : sql`r.owner_sub = ${of.ownerSub}`} AND i.density_g_per_ml IS NOT NULL AND i.is_liquid IS NULL
    AND line.value->'quantity'->>'unit' = ANY(${[...WEIGHED]}::text[])
  ORDER BY r.id, line.n`

/** How many lines across a cook's recipes have a question open: the profile's count (#180). */
export async function countWaiting(sql: Sql, ownerSub: string): Promise<number> {
  const [{ waiting }] = await sql<{ waiting: number }[]>`
    SELECT count(DISTINCT (r.id, c.line_id))::int AS waiting
    FROM recipes r
    CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) AS line(value)
    JOIN ingredient_candidates c ON c.recipe_id = r.id AND c.line_id = line.value->>'id' AND c.name = trim(line.value->>'name')
    WHERE r.owner_sub = ${ownerSub}`
  return waiting + (await about(sql, { ownerSub })).length
}

/**
 * What the owner is asked about this recipe: nothing unless they opted in.
 * Null means no such recipe, or not theirs.
 */
export async function readQuestions(sql: Sql, ownerSub: string, recipeId: string): Promise<{ lang: string, questions: IngredientQuestion[] } | null> {
  const [recipe] = await owned(sql, ownerSub, recipeId)
  if (!recipe) return null
  const lang = primaryLanguage(recipe.source_lang)
  if (!recipe.opted_in) return { lang, questions: [] }
  const questions = new Map<string, IngredientQuestion & { kind: 'match' }>()
  for (const row of await open(sql, recipeId)) {
    const question = questions.get(row.line_id) ?? { kind: 'match', lineId: row.line_id, name: row.name, candidates: [] }
    question.candidates.push({ ingredientId: row.ingredient_id, name: row.matched_name })
    questions.set(row.line_id, question)
  }
  // A line with a close match has no link, so it is never asked both.
  const abouts = (await about(sql, { recipeId })).map((row): IngredientQuestion =>
    ({ kind: 'about', lineId: row.line_id, name: row.name, ingredientId: row.ingredient_id }))
  return { lang, questions: [...questions.values(), ...abouts] }
}

/**
 * Answers the question on one line. `ingredientId` is the candidate meant,
 * for 'alias' and 'typo'. Null means there is no such question for this
 * owner: not their recipe, not opted in, no such line or candidate, the
 * line changed since it was asked, or its entry was answered meanwhile.
 * 'und' is a recipe whose language isn't known, where only 'typo' and the
 * liquid question file nothing under a language.
 */
export async function answerQuestion(sql: Sql, ownerSub: string, recipeId: string, lineId: string, answer: Answer, ingredientId: string | null): Promise<true | null | 'und'> {
  return sql.begin(async (tx) => {
    // Locked so a save, or a pass, can't change the line under the answer.
    const [recipe] = await owned(tx, ownerSub, recipeId, true)
    if (!recipe?.opted_in) return null
    if (answer === 'liquid' || answer === 'solid') return answerAbout(tx, recipeId, lineId, answer === 'liquid')
    const asked = (await open(tx, recipeId)).filter(row => row.line_id === lineId)
    if (!asked.length) return null
    const name = asked[0]!.name
    const lang = primaryLanguage(recipe.source_lang)
    if (lang === 'und' && answer !== 'typo') return 'und'

    if (answer === 'none') {
      await linkLine(tx, recipeId, ownerSub, lineId, name, await createEntry(tx, ownerSub, lang, name))
      await requeueAsking(tx, recipeId, name)
    } else {
      const picked = asked.find(row => row.ingredient_id === ingredientId)
      if (!picked) return null
      // Picking a name the store only guessed (an unconfirmed one) confirms
      // it; the first confirmed name in its language becomes the main one.
      await tx`
        UPDATE ingredient_names n SET confirmed = true, added_by = ${ownerSub},
          is_main = NOT EXISTS (SELECT 1 FROM ingredient_names m WHERE m.ingredient_id = n.ingredient_id AND m.lang = n.lang AND m.is_main)
        WHERE n.ingredient_id = ${picked.ingredient_id} AND lower(n.name) = lower(${picked.matched_name}) AND NOT n.confirmed`
      if (answer === 'alias') {
        // The cook's name, confirmed, in the recipe's language. Already the
        // entry's (unconfirmed): confirmed. Another entry's: left to it.
        await tx`
          INSERT INTO ingredient_names (ingredient_id, lang, name, is_main, confirmed, source, added_by)
          VALUES (${picked.ingredient_id}, ${lang}, ${name},
            NOT EXISTS (SELECT 1 FROM ingredient_names WHERE ingredient_id = ${picked.ingredient_id} AND lang = ${lang} AND is_main),
            true, 'cook', ${ownerSub})
          ON CONFLICT (lang, lower(name)) DO UPDATE SET confirmed = true
          WHERE ingredient_names.ingredient_id = EXCLUDED.ingredient_id`
        await linkLine(tx, recipeId, ownerSub, lineId, name, picked.ingredient_id)
        await requeueAsking(tx, recipeId, name)
      } else {
        // A typo: the line takes the store's spelling, and the misspelling
        // goes nowhere. originalText keeps what the source said.
        const ingredients = recipe.ingredients.map(line => line.id === lineId ? { ...line, name: picked.matched_name } : line)
        await tx`UPDATE recipes SET ingredients = ${tx.json(ingredients as never)} WHERE id = ${recipeId}`
        await linkLine(tx, recipeId, ownerSub, lineId, picked.matched_name.trim(), picked.ingredient_id)
      }
    }
    await tx`SELECT pg_notify(${MATCHED}, ${recipeId})`
    return true
  })
}

// For everyone at once; a second answer, racing or stale, finds the
// question gone and changes nothing. Every recipe using the entry is told,
// so the question leaves their pages too.
async function answerAbout(tx: TransactionSql, recipeId: string, lineId: string, liquid: boolean): Promise<true | null> {
  const asked = (await about(tx, { recipeId })).find(row => row.line_id === lineId)
  if (!asked) return null
  const [set] = await tx`UPDATE ingredients SET is_liquid = ${liquid} WHERE id = ${asked.ingredient_id} AND is_liquid IS NULL RETURNING id`
  if (!set) return null
  await tx`SELECT pg_notify(${MATCHED}, recipe_id::text) FROM (SELECT DISTINCT recipe_id FROM ingredient_links WHERE ingredient_id = ${asked.ingredient_id}) used`
  return true
}

// The name is now in the store, so every opted-in cook's recipe asking about
// it is matched again (#194): where it is now exact in the recipe's
// language, the pass links it and the question goes. One already queued
// keeps its place, so a batched backfill isn't pulled forward. A typo
// stores nothing, and settles nothing elsewhere.
async function requeueAsking(tx: TransactionSql, recipeId: string, name: string) {
  const queued = await tx`
    INSERT INTO ingredient_queue (recipe_id)
    SELECT DISTINCT c.recipe_id FROM ingredient_candidates c
    JOIN preferences p ON p.owner_sub = c.owner_sub AND p.settings->>${OPT_IN.key} = ${OPT_IN.value}
    WHERE lower(c.name) = lower(${name}) AND c.recipe_id <> ${recipeId}
    ON CONFLICT (recipe_id) DO NOTHING`
  if (queued.count) await tx`SELECT pg_notify('ingredient_queue', '')`
}
