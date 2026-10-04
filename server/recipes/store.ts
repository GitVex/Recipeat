import type { Kysely } from 'kysely'
import type { Sql } from 'postgres'
import { boolean, integer, json, numeric, text, uuid, type Database, type RecipeRow } from '../database/schema.ts'
import { fail } from '../extraction/errors.ts'
import { lineTags } from '../tags/store.ts'
import { copySourcePhoto, imageUrl } from '../images/store.ts'
import { recipeChanges } from '../../shared/utils/recipeDiff.ts'
import { NO_FILTERS, type RecipeFilters } from '../../shared/utils/recipeFilters.ts'
import type { ExtractedRecipe, RecipeBranch, RecipeDeletion, RecipeHistory, RecipeSummary, RecipeVersion, SavedRecipe } from '../../shared/types/recipe.ts'

// Shared with the app, which renders what these routes return.
export type { RecipeDeletion, RecipeHistory, RecipeSummary, SavedRecipe } from '../../shared/types/recipe.ts'

// The row as the table defines it. Restating it here is how it drifts from
// the migration, so it is imported instead.
type Row = RecipeRow

// NUMERIC arrives as a string, because it is arbitrary precision and a double
// is not. Portions are small, so reading it back into a number loses nothing.
const asRecipe = (row: Row, tags: string[]): SavedRecipe => ({
  id: row.id,
  tags,
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

// A line's tags, as lineTags reads them, for the statements written against
// postgres.js directly rather than through Kysely. `table` is the name or
// alias the recipes row is in scope as.
const tagsOf = (sql: Sql, table: string) => sql`(
  SELECT coalesce(array_agg(t.name ORDER BY lower(t.name), t.name), '{}')
  FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
  WHERE rt.line_id = ${sql(table)}.line_id AND rt.owner_sub = ${sql(table)}.owner_sub
)`

// cardCover in server/images/store.ts, for postgres.js: the version's own
// cover, else the newest one in its line.
const coverOf = (sql: Sql, table: string) => sql`(
  SELECT i.id FROM images i JOIN recipes v ON v.id = i.recipe_id AND v.owner_sub = i.owner_sub
  WHERE i.cover AND v.line_id = ${sql(table)}.line_id AND v.owner_sub = ${sql(table)}.owner_sub
  ORDER BY v.id = ${sql(table)}.id DESC, i.created_at DESC
  LIMIT 1
)`

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
  // A line that did not exist a moment ago has no tags.
  return asRecipe(row, [])
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
  const [row] = await sql<(Row & { tags: string[] })[]>`
    UPDATE recipes SET
      title = ${recipe.title}, source_lang = ${recipe.source_lang}, portions = ${recipe.portions},
      image = ${recipe.image}, total_time = ${recipe.totalTime},
      ingredients = ${sql.json(recipe.ingredients)}, steps = ${sql.json(recipe.steps)}, source = ${sql.json(recipe.source)}
    WHERE id = ${id} AND owner_sub = ${ownerSub}
    RETURNING *, ${tagsOf(sql, 'recipes')} AS tags
  `
  return row ? asRecipe(row, row.tags) : null
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
        // The line's, which it joined: a progression is still the same dish.
        .returning(lineTags('recipes').as('tags'))
        .executeTakeFirst()
    })
    return row ? asRecipe(row, row.tags) : null
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
 * and then deleted. It starts with a copy of the tags its parent's line had,
 * which are its own from then on. Null means no such parent, or not theirs.
 */
export async function insertVariant(db: Kysely<Database>, ownerSub: string, parentId: string, recipe: ExtractedRecipe): Promise<SavedRecipe | null> {
  return db.transaction().execute(async (tx) => {
    const row = await insertBranch(tx, ownerSub, parentId, recipe)
    if (!row) return null
    await copySourcePhoto(tx, ownerSub, parentId, row.id)
    await tx
      .insertInto('recipe_tags')
      .columns(['line_id', 'tag_id', 'owner_sub'])
      .expression(eb => eb
        .selectFrom('recipe_tags as rt')
        .innerJoin('recipes as parent', join => join.onRef('parent.line_id', '=', 'rt.line_id').onRef('parent.owner_sub', '=', 'rt.owner_sub'))
        // In the order of the columns above: INSERT ... SELECT goes by position.
        .select([uuid(row.id).as('line_id'), 'rt.tag_id', 'rt.owner_sub'])
        .where('parent.id', '=', parentId)
        .where('parent.owner_sub', '=', ownerSub))
      .execute()
    const { tags } = await tx
      .selectFrom('recipes')
      .select(lineTags('recipes').as('tags'))
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow()
    return asRecipe(row, tags)
  })
}

// The variant's own row, written from its parent's in one statement.
const insertBranch = (db: Kysely<Database>, ownerSub: string, parentId: string, recipe: ExtractedRecipe) =>
  db
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

/**
 * **Delete.** The version named and every progression descended from it;
 * variants that branched off any of them survive with `variant_of` cleared,
 * which is the foreign key's doing. What the foreign key cannot do is move a
 * pin, so this does: a pin among the deleted reverts to the deleted version's
 * parent, and deleting a root takes its whole line, pin and all.
 *
 * The line is read whole — one scan of recipes_line_idx — and the subtree is
 * walked here rather than in a recursive CTE. When deleting, those rows are
 * locked first, so a progression saved into the line at the same moment
 * either lands before the count is taken or waits until the deletion is done.
 *
 * `dryRun` answers the same question without deleting, by the same walk, so
 * the count a person confirms is the count this would remove.
 *
 * Null means no such version, or not theirs.
 */
export async function deleteRecipe(sql: Sql, ownerSub: string, id: string, { dryRun = false } = {}): Promise<RecipeDeletion | null> {
  try {
    return await sql.begin(async (tx) => {
      const line = await tx<Pick<Row, 'id' | 'progression_of' | 'pinned'>[]>`
        SELECT id, progression_of, pinned FROM recipes
        WHERE line_id = (SELECT line_id FROM recipes WHERE id = ${id} AND owner_sub = ${ownerSub})
        ${dryRun ? tx`` : tx`FOR UPDATE`}
      `
      const target = line.find(row => row.id === id)
      // Gone between finding its line and locking it: a deletion that raced
      // this one got there first.
      if (!target) return null

      const children = Map.groupBy(line, row => row.progression_of)
      const ids: string[] = []
      for (let queue = [id]; queue.length;) {
        const next = queue.shift()!
        ids.push(next)
        queue.push(...(children.get(next) ?? []).map(row => row.id))
      }

      const taken = new Set(ids)
      const pin = line.find(row => row.pinned)
      // A root has no parent to revert to, and every other version in its line
      // descends from it: the line ends.
      const pinned = pin && !taken.has(pin.id) ? pin.id : target.progression_of

      // The images the foreign key will take: theirs, and the source photo on
      // the root when the root is among them.
      const [{ photos }] = await tx<{ photos: number }[]>`
        SELECT count(*)::int AS photos FROM images WHERE recipe_id = ANY(${ids}) AND owner_sub = ${ownerSub}
      `
      if (dryRun) return { count: ids.length, ids, pinned, photos }

      const deleted = await tx<{ id: string }[]>`
        DELETE FROM recipes WHERE id = ANY(${ids}) AND owner_sub = ${ownerSub} RETURNING id
      `
      if (pinned && pinned !== pin?.id) await tx`UPDATE recipes SET pinned = true WHERE id = ${pinned}`
      return { count: deleted.length, ids: deleted.map(row => row.id), pinned, photos }
    })
  } catch (error) {
    // The line is locked, so this should not happen; if a write that skipped
    // the lock pinned something meanwhile, the index refuses the second pin
    // and nothing is deleted.
    if ((error as { constraint_name?: string }).constraint_name === 'recipes_line_pin_idx') {
      throw fail(409, 'This recipe changed while it was being deleted. Try again.', error)
    }
    throw error
  }
}

// What a card is read from, wherever the card appears: the listing here, and a
// collection's entries in server/collections/store.ts.
export type SummaryRow = Pick<Row, 'id' | 'line_id' | 'title' | 'image' | 'total_time' | 'portions' | 'created_at' | 'updated_at'> & { ingredient_count: number, step_count: number, tags: string[], cover_id: string | null }

export const asSummary = (row: SummaryRow): RecipeSummary => ({
  id: row.id,
  lineId: row.line_id,
  title: row.title,
  image: row.cover_id ? imageUrl(row.cover_id, 'thumb') : row.image,
  totalTime: row.total_time,
  portions: row.portions === null ? null : Number(row.portions),
  tags: row.tags,
  ingredientCount: row.ingredient_count,
  stepCount: row.step_count,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

// A term as an ILIKE pattern that finds it anywhere, with the three
// characters LIKE gives a meaning to taken literally.
const containing = (term: string) => `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`

/**
 * One entry per line: the pinned version, newest first. This is the query the
 * partial index exists for, and the reason an unpinned version reaches no
 * listing, no filter count and no search result.
 *
 * Filters narrow it (#14), each on top of the others. They are conditions on
 * the row the index hands over, never a different way in: the scan is still
 * the owner's pinned rows newest first, and the limit still stops it early.
 * A line's tags are matched in any case, and it has to wear all of them.
 */
export async function listRecipes(sql: Sql, ownerSub: string, filters: RecipeFilters = NO_FILTERS, limit = 200): Promise<RecipeSummary[]> {
  return (await listing(sql, ownerSub, filters, limit)).map(row => ({ ...asSummary(row), inCollection: row.in_collection }))
}

// The statement listRecipes runs, unrun: the tests explain this rather than a
// copy of it that could drift.
export function listing(sql: Sql, ownerSub: string, filters: RecipeFilters, limit: number) {
  const where = [
    filters.q ? sql`AND title ILIKE ${containing(filters.q)}` : sql``,
    filters.tags.length
      ? sql`AND (
          SELECT count(DISTINCT lower(t.name)) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
          WHERE rt.line_id = recipes.line_id AND rt.owner_sub = recipes.owner_sub
            AND lower(t.name) IN (SELECT lower(name) FROM unnest(${filters.tags}::text[]) AS name)
        ) = (SELECT count(DISTINCT lower(name)) FROM unnest(${filters.tags}::text[]) AS name)`
      : sql``,
    ...filters.ingredients.map(term => sql`AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(ingredients) AS ingredient
      WHERE ingredient->>'name' ILIKE ${containing(term)}
    )`),
    filters.maxTime !== null ? sql`AND total_time <= ${filters.maxTime}` : sql``,
    filters.minPortions !== null ? sql`AND portions >= ${filters.minPortions}` : sql``,
    filters.maxPortions !== null ? sql`AND portions <= ${filters.maxPortions}` : sql``,
    filters.sources.length ? sql`AND source->>'type' = ANY(${filters.sources}::text[])` : sql``,
  ]
  return sql<(SummaryRow & { in_collection: boolean })[]>`
    SELECT id, line_id, title, image, total_time, portions, created_at, updated_at,
           jsonb_array_length(ingredients) AS ingredient_count,
           jsonb_array_length(steps) AS step_count,
           ${tagsOf(sql, 'recipes')} AS tags,
           ${coverOf(sql, 'recipes')} AS cover_id,
           EXISTS (
             SELECT 1 FROM collection_recipes cr
             WHERE cr.recipe_id = recipes.id AND cr.owner_sub = recipes.owner_sub
           ) AS in_collection
    FROM recipes
    WHERE owner_sub = ${ownerSub} AND pinned
    ${where.reduce((all, condition) => sql`${all} ${condition}`)}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `
}

/**
 * One recipe, scoped to its owner. A row belonging to someone else is absent
 * rather than forbidden: whether a given id exists is not theirs to learn.
 */
export async function findRecipe(sql: Sql, ownerSub: string, id: string): Promise<SavedRecipe | null> {
  const [row] = await sql<(Row & { tags: string[] })[]>`
    SELECT *, ${tagsOf(sql, 'recipes')} AS tags FROM recipes WHERE id = ${id} AND owner_sub = ${ownerSub}
  `
  return row ? asRecipe(row, row.tags) : null
}

/**
 * A version's history: every version in its line, what branched off any of
 * them, and what the line itself branched off. The line is one scan of
 * recipes_line_idx, and each version is its card fields rather than the whole
 * row — a line of thirty progressions is not thirty recipes on the wire.
 *
 * The content is read all the same, to say how each version differs from
 * the line's original, and goes no further than here: the answer carries the
 * counts and the changed lines, not the recipes. Compared on every read rather than stored, so a version overwritten
 * since is compared as it is now.
 *
 * A variant is shown by its own entry point, which is the pinned version of
 * the line it started, and nothing below that. A line whose origin was
 * deleted has `variant_of` null on its root and answers with no origin.
 *
 * Null means no such version, or not theirs.
 */
export async function readHistory(sql: Sql, ownerSub: string, id: string): Promise<RecipeHistory | null> {
  const line = await sql<Pick<Row, 'id' | 'title' | 'line_id' | 'progression_of' | 'variant_of' | 'pinned' | 'created_at' | 'updated_at' | 'source_lang' | 'portions' | 'total_time' | 'ingredients' | 'steps'>[]>`
    SELECT id, title, line_id, progression_of, variant_of, pinned, created_at, updated_at,
           source_lang, portions, total_time, ingredients, steps
    FROM recipes
    WHERE owner_sub = ${ownerSub}
      AND line_id = (SELECT line_id FROM recipes WHERE id = ${id} AND owner_sub = ${ownerSub})
    ORDER BY created_at, id
  `
  if (!line.some(row => row.id === id)) return null
  const lineId = line[0]!.line_id
  // The root is the row the line is named after; only it can be a variant.
  const root = line.find(row => row.id === lineId)
  const from = root?.variant_of ?? null
  const content = (row: (typeof line)[number]) => ({
    title: row.title,
    source_lang: row.source_lang,
    portions: row.portions === null ? null : Number(row.portions),
    totalTime: row.total_time,
    ingredients: row.ingredients,
    steps: row.steps,
  })
  const original = root ? content(root) : null

  const [variants, origin] = await Promise.all([
    sql<{ id: string, title: string | null, created_at: Date, variant_of: string }[]>`
      -- The variant's own row stands in for an entry point only if its line
      -- somehow has none; a title can be null, so it is not coalesced.
      SELECT coalesce(entry.id, variant.id) AS id,
             CASE WHEN entry.id IS NULL THEN variant.title ELSE entry.title END AS title,
             variant.created_at, variant.variant_of
      FROM recipes variant
      LEFT JOIN recipes entry
        ON entry.line_id = variant.id AND entry.pinned AND entry.owner_sub = variant.owner_sub
      WHERE variant.owner_sub = ${ownerSub} AND variant.variant_of = ANY(${line.map(row => row.id)})
      ORDER BY variant.created_at, variant.id
    `,
    from
      ? sql<{ id: string, title: string | null }[]>`SELECT id, title FROM recipes WHERE id = ${from} AND owner_sub = ${ownerSub}`
      : Promise.resolve([]),
  ])

  return {
    lineId,
    versions: line.map((row): RecipeVersion => ({
      id: row.id,
      title: row.title,
      progressionOf: row.progression_of,
      pinned: row.pinned,
      ingredientCount: row.ingredients.length,
      stepCount: row.steps.length,
      changes: original && row.id !== lineId ? recipeChanges(original, content(row)) : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    variants: variants.map((row): RecipeBranch => ({
      id: row.id,
      title: row.title,
      variantOf: row.variant_of,
      createdAt: row.created_at.toISOString(),
    })),
    origin: origin[0] ?? null,
  }
}

/**
 * **Pin.** Makes a version the entry point of its line: the one the
 * collection shows. The only write besides a new progression that moves a pin,
 * and the way back to a version reached by going backwards without making
 * another one off it.
 *
 * The line is locked first, as a deletion locks it, so a progression or a
 * deletion racing this one lands wholly before or wholly after it. Pinning
 * the version already pinned changes nothing.
 *
 * Null means no such version, or not theirs.
 */
export async function pinRecipe(sql: Sql, ownerSub: string, id: string): Promise<{ pinned: string, lineId: string } | null> {
  try {
    return await sql.begin(async (tx) => {
      const line = await tx<Pick<Row, 'id' | 'line_id' | 'pinned'>[]>`
        SELECT id, line_id, pinned FROM recipes
        WHERE line_id = (SELECT line_id FROM recipes WHERE id = ${id} AND owner_sub = ${ownerSub})
          AND owner_sub = ${ownerSub}
        FOR UPDATE
      `
      const target = line.find(row => row.id === id)
      if (!target) return null
      if (!target.pinned) {
        await tx`UPDATE recipes SET pinned = false WHERE line_id = ${target.line_id} AND pinned AND owner_sub = ${ownerSub}`
        await tx`UPDATE recipes SET pinned = true WHERE id = ${id} AND owner_sub = ${ownerSub}`
      }
      return { pinned: id, lineId: target.line_id }
    })
  } catch (error) {
    if ((error as { constraint_name?: string }).constraint_name === 'recipes_line_pin_idx') {
      throw fail(409, 'This recipe changed while it was being pinned. Try again.', error)
    }
    throw error
  }
}
