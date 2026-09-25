import type { Sql } from 'postgres'
import type { ExtractedRecipe } from '../extraction/recipe.ts'

// A saved recipe is an extracted one plus what the table knows about it: which
// row it is, when it was written, and where it sits in its line. The lineage
// fields are read-only here — #29 owns the writes that move them.
export type SavedRecipe = ExtractedRecipe & {
  id: string
  lineId: string
  progressionOf: string | null
  variantOf: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

// What a collection card needs and no more. The rows carry whole recipes in
// JSONB, and a listing that returns fifty of them to render fifty titles is
// paying for the detail route twice.
export type RecipeSummary = Pick<SavedRecipe, 'id' | 'title' | 'image' | 'totalTime' | 'portions' | 'createdAt' | 'updatedAt'> & {
  ingredientCount: number
  stepCount: number
}

type Row = {
  id: string
  title: string | null
  source_lang: string
  portions: string | null
  image: string | null
  total_time: number | null
  ingredients: ExtractedRecipe['ingredients']
  steps: ExtractedRecipe['steps']
  source: ExtractedRecipe['source']
  line_id: string
  progression_of: string | null
  variant_of: string | null
  pinned: boolean
  created_at: Date
  updated_at: Date
}

// NUMERIC arrives as a string, because it is arbitrary precision and a double
// is not. Portions are small, so reading it back into a number loses nothing.
const asRecipe = (row: Row): SavedRecipe => ({
  id: row.id,
  title: row.title,
  source_lang: row.source_lang,
  portions: row.portions === null ? null : Number(row.portions),
  image: row.image,
  totalTime: row.total_time,
  ingredients: row.ingredients,
  steps: row.steps,
  source: row.source,
  lineId: row.line_id,
  progressionOf: row.progression_of,
  variantOf: row.variant_of,
  pinned: row.pinned,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

/**
 * Writes a recipe as the first version of a line of its own: no parent, and
 * pinned, because a line whose only version is not the entry point would
 * appear in no listing at all.
 *
 * `owner_sub` is a parameter rather than a field on the recipe so that a
 * caller cannot pass one in a body. `line_id` is left out entirely — the
 * table's own trigger points it at the new row.
 */
export async function insertRecipe(sql: Sql, ownerSub: string, recipe: ExtractedRecipe): Promise<SavedRecipe> {
  const [row] = await sql<Row[]>`
    INSERT INTO recipes (
      owner_sub, title, source_lang, portions, image, total_time,
      ingredients, steps, source, pinned
    ) VALUES (
      ${ownerSub}, ${recipe.title}, ${recipe.source_lang}, ${recipe.portions},
      ${recipe.image}, ${recipe.totalTime},
      ${sql.json(recipe.ingredients)}, ${sql.json(recipe.steps)}, ${sql.json(recipe.source)},
      true
    )
    RETURNING *
  `
  return asRecipe(row!)
}

/**
 * One entry per line: the pinned version, newest first. This is the query the
 * partial index exists for, and the reason an unpinned version reaches no
 * listing, no filter count and no search result.
 */
export async function listRecipes(sql: Sql, ownerSub: string, limit = 200): Promise<RecipeSummary[]> {
  const rows = await sql<(Pick<Row, 'id' | 'title' | 'image' | 'total_time' | 'portions' | 'created_at' | 'updated_at'> & { ingredient_count: number, step_count: number })[]>`
    SELECT id, title, image, total_time, portions, created_at, updated_at,
           jsonb_array_length(ingredients) AS ingredient_count,
           jsonb_array_length(steps) AS step_count
    FROM recipes
    WHERE owner_sub = ${ownerSub} AND pinned
    ORDER BY created_at DESC
    LIMIT ${limit}
  `
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    image: row.image,
    totalTime: row.total_time,
    portions: row.portions === null ? null : Number(row.portions),
    ingredientCount: row.ingredient_count,
    stepCount: row.step_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }))
}

/**
 * One recipe, scoped to its owner. A row belonging to someone else is absent
 * rather than forbidden: whether a given id exists is not theirs to learn.
 */
export async function findRecipe(sql: Sql, ownerSub: string, id: string): Promise<SavedRecipe | null> {
  const [row] = await sql<Row[]>`
    SELECT * FROM recipes WHERE id = ${id} AND owner_sub = ${ownerSub}
  `
  return row ? asRecipe(row) : null
}
