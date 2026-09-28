import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { jsonArrayFrom } from 'kysely/helpers/postgres'
import type { Database } from '../database/schema.ts'
import { fail } from '../extraction/errors.ts'
import type { Collection, CollectionSummary, CollectionThumbnail } from '../../shared/types/collection.ts'

export type { Collection, CollectionSummary, CollectionThumbnail } from '../../shared/types/collection.ts'

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
