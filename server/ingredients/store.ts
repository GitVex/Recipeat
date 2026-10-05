import type { Kysely, RawBuilder } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../database/schema.ts'
import { primaryLang } from './normalize.ts'

/**
 * The ingredient that stands for `id` today: itself, or the end of its
 * `merged_into` chain. A scalar subquery, so it can take a column.
 */
const survivor = (id: RawBuilder<number> | number) => sql<number | null>`(
  WITH RECURSIVE chain AS (
    SELECT id, merged_into FROM ingredients WHERE id = ${id}
    UNION
    SELECT i.id, i.merged_into FROM chain JOIN ingredients i ON i.id = chain.merged_into
  )
  SELECT id FROM chain WHERE merged_into IS NULL
)`

/**
 * Step 2 of canonization (#154): the key a normalized name has in a recipe of
 * `lang`, followed through merges, or null on a miss. Only that language's
 * aliases count; a name written the same in another is the later steps' to
 * find.
 */
export async function lookupAlias(db: Kysely<Database>, nameNorm: string, lang: string): Promise<number | null> {
  const { rows: [row] } = await sql<{ id: number | null }>`
    SELECT ${survivor(sql.ref('a.ingredient_id'))} AS id
    FROM ingredient_aliases a
    WHERE a.alias_norm = ${nameNorm} AND a.lang = ${primaryLang(lang)}
  `.execute(db)
  return row?.id ?? null
}

export type NewAlias = {
  nameRaw: string
  nameNorm: string
  lang: string
  ingredientId: number
  source: string
  confidence?: number | null
  recipeId?: string | null
}

/**
 * Step 7: records that a name means `ingredientId`. An alias already there
 * stays, whoever wrote it and whenever: two writers at once end with one row.
 * If it stands for a different ingredient than this one, the disagreement is
 * logged for review in canonization_decisions rather than settled here.
 *
 * Returns the key the name has now, which is what the line should take.
 */
export async function writeAlias(db: Kysely<Database>, alias: NewAlias): Promise<{ ingredientId: number, collision: boolean }> {
  const lang = primaryLang(alias.lang)
  await sql`
    INSERT INTO ingredient_aliases (alias_norm, lang, ingredient_id, source, confidence)
    VALUES (${alias.nameNorm}, ${lang}, ${alias.ingredientId}, ${alias.source}, ${alias.confidence ?? null})
    ON CONFLICT (alias_norm, lang) DO NOTHING
  `.execute(db)

  // A new statement, so it sees a row a concurrent writer committed while
  // this one's insert waited on it.
  const { rows: [row] } = await sql<{ existing: number, proposed: number }>`
    SELECT ${survivor(sql.ref('a.ingredient_id'))} AS existing, ${survivor(alias.ingredientId)} AS proposed
    FROM ingredient_aliases a
    WHERE a.alias_norm = ${alias.nameNorm} AND a.lang = ${lang}
  `.execute(db)
  const collision = row!.existing !== row!.proposed
  if (collision) {
    await sql`
      INSERT INTO canonization_decisions (recipe_id, name_raw, name_norm, lang, outcome, ingredient_id)
      VALUES (${alias.recipeId ?? null}, ${alias.nameRaw}, ${alias.nameNorm}, ${lang}, 'review', ${alias.ingredientId})
    `.execute(db)
  }
  return { ingredientId: row!.existing, collision }
}
