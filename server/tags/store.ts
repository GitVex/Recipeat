import type { Kysely, RawBuilder } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../database/schema.ts'
import type { TagSummary } from '../../shared/types/tag.ts'

export type { TagSummary } from '../../shared/types/tag.ts'

/**
 * A line's tags, A to Z, as one column of a statement that has a recipes row
 * in scope as `alias`: any version of the line reads the same set.
 */
export const lineTags = (alias: string): RawBuilder<string[]> => sql<string[]>`(
  SELECT coalesce(array_agg(t.name ORDER BY lower(t.name), t.name), '{}')
  FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
  WHERE rt.line_id = ${sql.ref(`${alias}.line_id`)} AND rt.owner_sub = ${sql.ref(`${alias}.owner_sub`)}
)`

/**
 * Every tag the owner has on a recipe, A to Z whatever the case, each with how
 * many recipes wear it: the filter's choices and the editor's suggestions.
 *
 * A tag no recipe wears any more is not listed. Its row is left where it is
 * rather than deleted with its last use: deleting it would race a write that
 * has just found it to reuse, and a name typed again is found again.
 */
export async function listTags(db: Kysely<Database>, ownerSub: string): Promise<TagSummary[]> {
  const { rows } = await sql<TagSummary>`
    SELECT t.name, count(*)::int AS count
    FROM tags t
    JOIN recipe_tags rt ON rt.tag_id = t.id AND rt.owner_sub = t.owner_sub
    WHERE t.owner_sub = ${ownerSub}
    GROUP BY t.id, t.name
    ORDER BY lower(t.name), t.name
  `.execute(db)
  return rows
}

/**
 * **Tag.** Makes `names` the whole set of tags on the line the version `id`
 * belongs to — any version of it, since they share one set. A name the owner
 * already has, in any case, is that tag and keeps the case it was first typed
 * in; a new one is made.
 *
 * The line's root is locked first, so two edits to one recipe's tags queue
 * rather than interleave, and a deletion of the line lands wholly before or
 * after. Tags kept from before keep when they were added.
 *
 * Returns the line's tags as stored, A to Z. Null means no such version, or
 * not theirs.
 */
export async function setTags(db: Kysely<Database>, ownerSub: string, id: string, names: string[]): Promise<string[] | null> {
  return db.transaction().execute(async (tx) => {
    const { rows: [line] } = await sql<{ id: string }>`
      SELECT root.id
      FROM recipes version
      JOIN recipes root ON root.id = version.line_id AND root.owner_sub = version.owner_sub
      WHERE version.id = ${id} AND version.owner_sub = ${ownerSub}
      FOR UPDATE OF root
    `.execute(tx)
    if (!line) return null

    // Made if new, found either way. The conflict target is the unique index
    // itself, so "Quick" and "quick" from two requests at once are one row.
    let tagIds: string[] = []
    if (names.length) {
      await sql`
        INSERT INTO tags (owner_sub, name)
        SELECT ${ownerSub}, name FROM unnest(${names}::text[]) AS name
        ON CONFLICT (owner_sub, lower(name)) DO NOTHING
      `.execute(tx)
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM tags
        WHERE owner_sub = ${ownerSub}
          AND lower(name) IN (SELECT lower(name) FROM unnest(${names}::text[]) AS name)
      `.execute(tx)
      tagIds = rows.map(row => row.id)
    }

    await sql`
      DELETE FROM recipe_tags
      WHERE line_id = ${line.id} AND owner_sub = ${ownerSub} AND tag_id <> ALL(${tagIds}::uuid[])
    `.execute(tx)
    if (tagIds.length) {
      await sql`
        INSERT INTO recipe_tags (line_id, tag_id, owner_sub)
        SELECT ${line.id}, tag_id, ${ownerSub} FROM unnest(${tagIds}::uuid[]) AS tag_id
        ON CONFLICT DO NOTHING
      `.execute(tx)
    }

    const { rows } = await sql<{ name: string }>`
      SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
      WHERE rt.line_id = ${line.id} AND rt.owner_sub = ${ownerSub}
      ORDER BY lower(t.name), t.name
    `.execute(tx)
    return rows.map(row => row.name)
  })
}
