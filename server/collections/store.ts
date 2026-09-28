import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import { jsonArrayFrom } from 'kysely/helpers/postgres'
import type { Database } from '../database/schema.ts'
import { fail } from '../extraction/errors.ts'
import { asSummary, type SummaryRow } from '../recipes/store.ts'
import { lineTags } from '../tags/store.ts'
import type { Collection, CollectionDetail, CollectionEntry, CollectionSummary, CollectionThumbnail } from '../../shared/types/collection.ts'

export type { Collection, CollectionDetail, CollectionEntry, CollectionSummary, CollectionThumbnail } from '../../shared/types/collection.ts'

type Row = { id: string, name: string, created_at: Date, updated_at: Date }

const asCollection = (row: Row): Collection => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

// The unique index on (owner_sub, lower(name)) is what knows about a second
// "Weeknight", so the two writes that set a name ask it rather than looking
// first and racing.
const named = async <T>(write: () => Promise<T>): Promise<T> => {
  try {
    return await write()
  } catch (error) {
    if ((error as { constraint_name?: string }).constraint_name === 'collections_owner_name_idx')
      throw fail(409, 'You already have a collection with that name.', error)
    throw error
  }
}

/**
 * Every collection the owner has, newest first, each with its count and the
 * first four recipes in its order: what a card and the header need, in one
 * statement.
 *
 * A thumbnail is the version that was added, read from its own row, so it is
 * the picture that version has even after the line's pin has moved on.
 */
export async function listCollections(db: Kysely<Database>, ownerSub: string): Promise<CollectionSummary[]> {
  const rows = await db
    .selectFrom('collections as c')
    .where('c.owner_sub', '=', ownerSub)
    .select(eb => [
      'c.id', 'c.name', 'c.created_at', 'c.updated_at',
      eb.selectFrom('collection_recipes as m')
        .whereRef('m.collection_id', '=', 'c.id')
        .select(sql<number>`count(*)::int`.as('n'))
        .as('count'),
      jsonArrayFrom(
        eb.selectFrom('collection_recipes as m')
          .innerJoin('recipes as r', join => join.onRef('r.id', '=', 'm.recipe_id').onRef('r.owner_sub', '=', 'm.owner_sub'))
          .whereRef('m.collection_id', '=', 'c.id')
          .orderBy('m.position')
          .limit(4)
          .select(['r.id', 'r.title', 'r.image']),
      ).as('thumbnails'),
    ])
    .orderBy('c.created_at', 'desc')
    .execute()
  return rows.map(row => ({
    ...asCollection(row),
    // A scalar subquery Kysely cannot see is never null here: count(*) of
    // nothing is 0.
    count: row.count ?? 0,
    thumbnails: row.thumbnails as CollectionThumbnail[],
  }))
}

export async function createCollection(db: Kysely<Database>, ownerSub: string, name: string): Promise<Collection> {
  const row = await named(() => db
    .insertInto('collections')
    .values({ owner_sub: ownerSub, name })
    .returning(['id', 'name', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow())
  return asCollection(row)
}

/**
 * Null means no such collection, or not theirs — the same answer either way.
 */
export async function renameCollection(db: Kysely<Database>, ownerSub: string, id: string, name: string): Promise<Collection | null> {
  const row = await named(() => db
    .updateTable('collections')
    .set({ name })
    .where('id', '=', id)
    .where('owner_sub', '=', ownerSub)
    .returning(['id', 'name', 'created_at', 'updated_at'])
    .executeTakeFirst())
  return row ? asCollection(row) : null
}

/**
 * Deletes the collection and, by cascade, its memberships. No recipe goes with
 * it: the foreign key runs from the membership to the recipe, never back.
 *
 * False means no such collection, or not theirs.
 */
export async function deleteCollection(db: Kysely<Database>, ownerSub: string, id: string): Promise<boolean> {
  const result = await db
    .deleteFrom('collections')
    .where('id', '=', id)
    .where('owner_sub', '=', ownerSub)
    .executeTakeFirst()
  return result.numDeletedRows > 0n
}

// The collection's own row, locked for the rest of the transaction: the writes
// that compute positions from what is already there take it first, so two of
// them at once queue rather than both claiming the same place. Undefined means
// no such collection, or not theirs.
const lock = (tx: Transaction<Database>, ownerSub: string, id: string) => tx
  .selectFrom('collections')
  .where('id', '=', id)
  .where('owner_sub', '=', ownerSub)
  .select(['id', 'name', 'created_at', 'updated_at'])
  .forUpdate()
  .executeTakeFirst()

// What Postgres named the membership's reference to a recipe in
// 002_collections.sql.
const RECIPE_REFERENCE = 'collection_recipes_recipe_id_owner_sub_fkey'

const entries = async (db: Kysely<Database> | Transaction<Database>, ownerSub: string, id: string): Promise<CollectionEntry[]> => {
  const { rows } = await sql<SummaryRow & { pinned: boolean, pinned_id: string | null }>`
    SELECT r.id, r.line_id, r.title, r.image, r.total_time, r.portions, r.created_at, r.updated_at,
           jsonb_array_length(r.ingredients) AS ingredient_count,
           jsonb_array_length(r.steps) AS step_count,
           ${lineTags('r')} AS tags,
           r.pinned, p.id AS pinned_id
    FROM collection_recipes m
    JOIN recipes r ON r.id = m.recipe_id AND r.owner_sub = m.owner_sub
    -- The line's entry point, for an entry that is no longer it. A line always
    -- has one, but a left join keeps an entry listed even if one went missing.
    LEFT JOIN recipes p ON p.line_id = r.line_id AND p.pinned
    WHERE m.collection_id = ${id} AND m.owner_sub = ${ownerSub}
    ORDER BY m.position
  `.execute(db)
  return rows.map(row => ({ ...asSummary(row), pinned: row.pinned, pinnedId: row.pinned_id }))
}

/**
 * A collection opened: its versions in order, each as the card the listing
 * shows. Null means no such collection, or not theirs.
 */
export async function readCollection(db: Kysely<Database>, ownerSub: string, id: string): Promise<CollectionDetail | null> {
  // One snapshot for the row and its entries, so a rename or a reorder in
  // between cannot pair one with the other's before.
  return db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
    const row = await tx.selectFrom('collections')
      .where('id', '=', id)
      .where('owner_sub', '=', ownerSub)
      .select(['id', 'name', 'created_at', 'updated_at'])
      .executeTakeFirst()
    return row ? { ...asCollection(row), recipes: await entries(tx, ownerSub, id) } : null
  })
}

/**
 * Puts a version at the end of a collection. Already there is not an error and
 * moves nothing: adding is something a person can do twice from two places.
 *
 * `'collection'` and `'recipe'` say which of the two was not found, or not
 * theirs. A recipe belonging to someone else fails at the membership's foreign
 * key rather than at a check here.
 */
export async function addToCollection(db: Kysely<Database>, ownerSub: string, id: string, recipeId: string): Promise<'added' | 'present' | 'collection' | 'recipe'> {
  try {
    return await db.transaction().execute(async (tx) => {
      if (!await lock(tx, ownerSub, id)) return 'collection'
      const { numAffectedRows } = await sql`
        INSERT INTO collection_recipes (collection_id, recipe_id, owner_sub, position)
        SELECT ${id}, ${recipeId}, ${ownerSub}, coalesce(max(position) + 1, 0)
        FROM collection_recipes WHERE collection_id = ${id}
        ON CONFLICT (collection_id, recipe_id) DO NOTHING
      `.execute(tx)
      return numAffectedRows ? 'added' : 'present'
    })
  } catch (error) {
    if ((error as { constraint_name?: string }).constraint_name === RECIPE_REFERENCE) return 'recipe'
    throw error
  }
}

/**
 * Takes a version out of a collection, and never deletes it. Not there is not
 * an error, for the same reason adding twice is not. False means no such
 * collection, or not theirs.
 *
 * The gap it leaves is allowed: positions only have to ascend.
 */
export async function removeFromCollection(db: Kysely<Database>, ownerSub: string, id: string, recipeId: string): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    if (!await lock(tx, ownerSub, id)) return false
    await tx.deleteFrom('collection_recipes')
      .where('collection_id', '=', id)
      .where('recipe_id', '=', recipeId)
      .where('owner_sub', '=', ownerSub)
      .execute()
    return true
  })
}

/**
 * The whole order at once, as the ids of every version in the collection.
 *
 * Anything but exactly the current members is refused with a 409 and changes
 * nothing: a list missing one was made before someone added it, and applying
 * it would have to guess where that one goes. The caller reads the collection
 * again and retries.
 */
export async function reorderCollection(db: Kysely<Database>, ownerSub: string, id: string, recipeIds: string[]): Promise<CollectionDetail | null> {
  return db.transaction().execute(async (tx) => {
    const row = await lock(tx, ownerSub, id)
    if (!row) return null
    const members = await tx.selectFrom('collection_recipes')
      .where('collection_id', '=', id)
      .select('recipe_id')
      .execute()
    const current = new Set(members.map(member => member.recipe_id))
    if (recipeIds.length !== current.size || !recipeIds.every(recipeId => current.has(recipeId)))
      throw fail(409, 'This collection changed since it was read. Reload it and try again.')
    // Positions from 0, in one statement. Uniqueness is checked at commit, so
    // rows passing through each other's places on the way is fine.
    await sql`
      UPDATE collection_recipes m SET position = o.ordinal - 1
      FROM unnest(${recipeIds}::uuid[]) WITH ORDINALITY AS o(recipe_id, ordinal)
      WHERE m.collection_id = ${id} AND m.recipe_id = o.recipe_id
    `.execute(tx)
    return { ...asCollection(row), recipes: await entries(tx, ownerSub, id) }
  })
}

/**
 * The ids of every collection a version is in, for the picker's ticks. Null
 * means no such recipe, or not theirs, so the picker cannot be used to learn
 * whether someone else's id exists.
 */
export async function collectionsContaining(db: Kysely<Database>, ownerSub: string, recipeId: string): Promise<string[] | null> {
  const recipe = await db.selectFrom('recipes')
    .where('id', '=', recipeId)
    .where('owner_sub', '=', ownerSub)
    .select('id')
    .executeTakeFirst()
  if (!recipe) return null
  const rows = await db.selectFrom('collection_recipes')
    .where('recipe_id', '=', recipeId)
    .where('owner_sub', '=', ownerSub)
    .select('collection_id')
    .execute()
  return rows.map(row => row.collection_id)
}
