import type { Kysely } from 'kysely'
import type { Sql } from 'postgres'
import { boolean, integer, json, numeric, text, type Database, type RecipeRow } from '../database/schema.ts'
import { fail } from '../extraction/errors.ts'
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

// The row as the table defines it. Restating it here is how it drifts from
// the migration, so it is imported instead.
type Row = RecipeRow

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

// The content half of a row, in one place, so that what a recipe becomes is
// written once and the three inserts differ only in their lineage. owner_sub
// is a parameter rather than a field on a recipe: there is no shape in which a
// request body could carry one.
const content = (ownerSub: string, recipe: ExtractedRecipe) => ({
  owner_sub: ownerSub,
  title: recipe.title,
  source_lang: recipe.source_lang,
  portions: recipe.portions,
  image: recipe.image,
  total_time: recipe.totalTime,
  // Cast rather than handed over as a string: a plain parameter into a jsonb
  // column is stored as a JSON *string*, and jsonb_typeof then refuses it.
  ingredients: json(recipe.ingredients),
  steps: json(recipe.steps),
  source: json(recipe.source),
})

// The same values as a SELECT list, for the two inserts that read their parent
// out of the table in the statement that writes the child. Every literal is
// cast: Postgres types a SELECT list before it knows what the INSERT will do
// with it.
const selected = (ownerSub: string, recipe: ExtractedRecipe) => [
  text(ownerSub).as('owner_sub'),
  text(recipe.title).as('title'),
  text(recipe.source_lang).as('source_lang'),
  numeric(recipe.portions).as('portions'),
  text(recipe.image).as('image'),
  integer(recipe.totalTime).as('total_time'),
  json(recipe.ingredients).as('ingredients'),
  json(recipe.steps).as('steps'),
  json(recipe.source).as('source'),
] as const

/**
 * Writes a recipe as the first version of a line of its own: no parent, and
 * pinned, because a line whose only version is not the entry point would
 * appear in no listing at all.
 *
 * `line_id` is left out entirely — the table's own trigger points it at the
 * new row.
 */
export async function insertRecipe(db: Kysely<Database>, ownerSub: string, recipe: ExtractedRecipe): Promise<SavedRecipe> {
  const row = await db
    .insertInto('recipes')
    .values({ ...content(ownerSub, recipe), pinned: true })
    .returningAll()
    .executeTakeFirstOrThrow()
  return asRecipe(row)
}

/**
 * **Save.** The recipe you had, corrected: same row, same id, same place in
 * the tree. It is the one write that cannot change the shape of a line —
 * no column below the content is named here, so a body cannot move a pin or
 * reparent a version by mentioning one.
 *
 * Works on any version the caller owns, pinned or not. Two saves racing is
 * last write wins: the second overwrites the first and `updated_at` says when.
 * Nothing is lost that a progression would have kept, and a person editing
 * their own recipe from two tabs is not a case worth a conflict for.
 *
 * Null means no such row, or not theirs.
 */
export async function updateRecipe(sql: Sql, ownerSub: string, id: string, recipe: ExtractedRecipe): Promise<SavedRecipe | null> {
  const [row] = await sql<Row[]>`
    UPDATE recipes SET
      title = ${recipe.title}, source_lang = ${recipe.source_lang}, portions = ${recipe.portions},
      image = ${recipe.image}, total_time = ${recipe.totalTime},
      ingredients = ${sql.json(recipe.ingredients)}, steps = ${sql.json(recipe.steps)}, source = ${sql.json(recipe.source)}
    WHERE id = ${id} AND owner_sub = ${ownerSub}
    RETURNING *
  `
  return row ? asRecipe(row) : null
}

/**
 * **Save as Progression.** A new version in the same line, descended from any
 * version the caller owns — pinned or not, which is what makes a line a tree
 * rather than a list. It takes the pin, wherever in the tree it was made from.
 *
 * Both statements filter on `owner_sub`, so a parent belonging to someone else
 * unpins nothing and inserts nothing: the caller gets the same answer as for
 * an id that does not exist, which is all they are owed.
 *
 * Null means no such parent, or not theirs.
 */
export async function insertProgression(db: Kysely<Database>, ownerSub: string, parentId: string, recipe: ExtractedRecipe): Promise<SavedRecipe | null> {
  try {
    const row = await db.transaction().execute(async (tx) => {
      // The line the parent belongs to, not the parent: the pin can be
      // anywhere in the tree, and this is the one that has to give it up.
      await tx
        .updateTable('recipes')
        .set({ pinned: false })
        .where('pinned', '=', true)
        .where('line_id', '=', eb => eb
          .selectFrom('recipes')
          .select('line_id')
          .where('id', '=', parentId)
          .where('owner_sub', '=', ownerSub))
        .execute()

      return await tx
        .insertInto('recipes')
        .columns([
          'owner_sub', 'title', 'source_lang', 'portions', 'image', 'total_time',
          'ingredients', 'steps', 'source', 'line_id', 'progression_of', 'pinned',
        ])
        .expression(eb => eb
          .selectFrom('recipes as parent')
          .select([
            ...selected(ownerSub, recipe),
            // Inherited, never taken from the caller, which is what keeps a
            // progression of a progression in the line it came from.
            'parent.line_id as line_id',
            'parent.id as progression_of',
            boolean(true).as('pinned'),
          ])
          // The ownership filter is in the statement that writes, so there is
          // no window between checking a parent and inserting a child.
          .where('parent.id', '=', parentId)
          .where('parent.owner_sub', '=', ownerSub))
        .returningAll()
        .executeTakeFirst()
    })
    return row ? asRecipe(row) : null
  } catch (error) {
    // Two progressions racing in one line: both unpinned, both inserted, and
    // recipes_line_pin_idx let exactly one of them through. The loser is a
    // retry rather than a bug.
    if ((error as { constraint_name?: string }).constraint_name === 'recipes_line_pin_idx') {
      throw fail(409, 'Another version of this recipe was saved at the same time. Try again.', error)
    }
    throw error
  }
}

/**
 * **Save as Variant.** A branch that leaves the line: it points at the version
 * it came from and becomes the first version of a line of its own, with its
 * own pin. `line_id` is left out so the table's trigger points it at the new
 * row, which is exactly what "its own line" means.
 *
 * One statement, so there is no window in which the parent could be checked
 * and then deleted. Null means no such parent, or not theirs.
 */
export async function insertVariant(db: Kysely<Database>, ownerSub: string, parentId: string, recipe: ExtractedRecipe): Promise<SavedRecipe | null> {
  const row = await db
    .insertInto('recipes')
    .columns([
      'owner_sub', 'title', 'source_lang', 'portions', 'image', 'total_time',
      'ingredients', 'steps', 'source', 'variant_of', 'pinned',
    ])
    .expression(eb => eb
      .selectFrom('recipes as parent')
      .select([
        ...selected(ownerSub, recipe),
        'parent.id as variant_of',
        boolean(true).as('pinned'),
      ])
      .where('parent.id', '=', parentId)
      .where('parent.owner_sub', '=', ownerSub))
    .returningAll()
    .executeTakeFirst()
  return row ? asRecipe(row) : null
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
