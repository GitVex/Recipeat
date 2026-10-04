import type { Kysely } from 'kysely'
import type { Sql } from 'postgres'
import type { Database } from '../database/schema.ts'
import { hasFoods, sightedName, type FoodEntry } from '../extraction/ingredients.ts'
import type { ExtractedRecipe } from '../extraction/recipe.ts'

/** Every active key with its names, as the matcher's snapshot holds them. */
export async function readFoods(sql: Sql): Promise<FoodEntry[]> {
  return sql<FoodEntry[]>`
    SELECT i.key, i.form, i.grams_per_ml AS "gramsPerMl",
           coalesce(array_agg(n.name ORDER BY n.position) FILTER (WHERE n.lang = 'en'), '{}') AS en,
           coalesce(array_agg(n.name ORDER BY n.position) FILTER (WHERE n.lang = 'de'), '{}') AS de
    FROM ingredients i LEFT JOIN ingredient_names n ON n.key = i.key
    GROUP BY i.key
    ORDER BY i.key
  `
}

/**
 * The sightings a saved recipe makes: one per distinct name it holds that
 * matched nothing. None without a snapshot, or every seeded name would be
 * sighted as unknown, and none for a language the table has no names in.
 */
export function sightings(ownerSub: string, recipeId: string, recipe: ExtractedRecipe) {
  const lang = recipe.source_lang.toLowerCase().slice(0, 2)
  if (!hasFoods() || (lang !== 'en' && lang !== 'de')) return []
  const names = new Set(recipe.ingredients.filter(ingredient => !ingredient.food).map(ingredient => sightedName(ingredient.name)))
  names.delete(null)
  return [...names].map(name => ({ name: name!, lang: lang as 'en' | 'de', owner_sub: ownerSub, recipe_id: recipeId }))
}

// Written in the save's own transaction. A name this recipe was already seen
// with is not seen again.
export async function recordSightings(db: Kysely<Database>, ownerSub: string, recipeId: string, recipe: ExtractedRecipe): Promise<void> {
  const rows = sightings(ownerSub, recipeId, recipe)
  if (rows.length) await db.insertInto('ingredient_sightings').values(rows).onConflict(conflict => conflict.doNothing()).execute()
}

// The same, for a write made with postgres.js.
export async function recordSightingsSql(sql: Sql, ownerSub: string, recipeId: string, recipe: ExtractedRecipe): Promise<void> {
  const rows = sightings(ownerSub, recipeId, recipe)
  if (rows.length) await sql`INSERT INTO ingredient_sightings ${sql(rows)} ON CONFLICT DO NOTHING`
}
