import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely'
import { uuid, type Database } from '../database/schema.ts'
import { fail } from '../extraction/errors.ts'
import type { RecipePhotos } from '../../shared/types/recipe.ts'
import type { ImageUpload } from './upload.ts'

export type { RecipePhotos } from '../../shared/types/recipe.ts'

import { imageUrl, MAX_PHOTOS } from '../../shared/utils/images.ts'

export { imageUrl, MAX_PHOTOS }

type Db = Kysely<Database> | Transaction<Database>

/**
 * One image's bytes, in the size asked for, if the caller owns it. Someone
 * else's is absent rather than forbidden, as a recipe is. The only statement
 * that reads `data` or `thumb`: everything else names its columns, so a
 * listing never drags megabytes through the pool.
 */
export async function readImage(db: Db, ownerSub: string, id: string, size: 'full' | 'thumb') {
  return db
    .selectFrom('images')
    .select(['media_type', size === 'thumb' ? 'thumb as bytes' : 'data as bytes'])
    .where('id', '=', id)
    .where('owner_sub', '=', ownerSub)
    .executeTakeFirst()
}

/**
 * A version's photos in order, and its line's source photo. Ids only: the
 * page asks for each picture by its own address.
 */
async function photosOf(db: Db, ownerSub: string, recipeId: string): Promise<RecipePhotos> {
  const rows = await db
    .selectFrom('images as i')
    .innerJoin('recipes as r', join => join.onRef('r.owner_sub', '=', 'i.owner_sub'))
    .select(['i.id', 'i.kind', 'i.cover'])
    .where('r.id', '=', recipeId)
    .where('r.owner_sub', '=', ownerSub)
    .where(eb => eb.or([
      eb.and([eb('i.kind', '=', 'dish'), eb('i.recipe_id', '=', eb.ref('r.id'))]),
      eb.and([eb('i.kind', '=', 'source'), eb('i.recipe_id', '=', eb.ref('r.line_id'))]),
    ]))
    .orderBy('i.position')
    .execute()
  const line = await db
    .selectFrom('recipes as r')
    .select(cardCover('r').as('cover'))
    .where('r.id', '=', recipeId)
    .where('r.owner_sub', '=', ownerSub)
    .executeTakeFirst()
  return {
    photos: rows.filter(row => row.kind === 'dish').map(row => ({ id: row.id, cover: row.cover })),
    source: rows.find(row => row.kind === 'source')?.id ?? null,
    lineCover: line?.cover ?? null,
  }
}

// The version, locked, so writes to one version's photos queue rather than
// interleave, and a deletion of it lands wholly before or after. Undefined
// means no such version, or not theirs.
const lock = (tx: Transaction<Database>, ownerSub: string, recipeId: string) => tx
  .selectFrom('recipes')
  .select(['id', 'line_id'])
  .where('id', '=', recipeId)
  .where('owner_sub', '=', ownerSub)
  .forUpdate()
  .executeTakeFirst()

export async function listPhotos(db: Db, ownerSub: string, recipeId: string): Promise<RecipePhotos | null> {
  const recipe = await db.selectFrom('recipes').select('id').where('id', '=', recipeId).where('owner_sub', '=', ownerSub).executeTakeFirst()
  return recipe ? photosOf(db, ownerSub, recipeId) : null
}

/**
 * **Add a photo** to the end of a version's. The first one is its cover. The
 * eleventh is refused here with a reason; the table would refuse it too.
 */
export async function addPhoto(db: Kysely<Database>, ownerSub: string, recipeId: string, upload: ImageUpload): Promise<RecipePhotos | null> {
  return db.transaction().execute(async (tx) => {
    if (!await lock(tx, ownerSub, recipeId)) return null
    const { count, covers } = await tx
      .selectFrom('images')
      .select(eb => [eb.fn.countAll<number>().as('count'), eb.fn.count<number>('id').filterWhere('cover', '=', true).as('covers')])
      .where('recipe_id', '=', recipeId)
      .where('kind', '=', 'dish')
      .executeTakeFirstOrThrow()
    if (Number(count) >= MAX_PHOTOS) throw fail(409, `A recipe can have ${MAX_PHOTOS} photos at most.`)
    await tx.insertInto('images').values({
      recipe_id: recipeId,
      owner_sub: ownerSub,
      kind: 'dish',
      // Positions are kept without gaps, so the count is the next one.
      position: Number(count),
      cover: Number(covers) === 0,
      media_type: upload.mediaType,
      data: upload.data,
      thumb: upload.thumb,
    }).execute()
    return photosOf(tx, ownerSub, recipeId)
  })
}

/**
 * **Arrange** a version's photos: `order` is every one of them, in the order
 * wanted, and `cover` is one of them or null for none. The whole arrangement
 * rather than a move, so sending it twice is sending it once. An order that
 * leaves one out or names one that is not there is refused, since it was
 * made from a page that is out of date.
 */
export async function arrangePhotos(db: Kysely<Database>, ownerSub: string, recipeId: string, order: string[], cover: string | null): Promise<RecipePhotos | null> {
  return db.transaction().execute(async (tx) => {
    if (!await lock(tx, ownerSub, recipeId)) return null
    const current = (await photosOf(tx, ownerSub, recipeId)).photos.map(photo => photo.id)
    const same = order.length === current.length && new Set(order).size === order.length && order.every(id => current.includes(id))
    if (!same || (cover !== null && !order.includes(cover))) {
      throw fail(409, 'These photos changed in the meantime. Reload and try again.')
    }
    if (order.length) {
      // The old cover first, in a statement of its own: one cover per version
      // is a unique index, which is checked row by row, not at the end.
      await tx.updateTable('images').set({ cover: false }).where('recipe_id', '=', recipeId).where('cover', '=', true).execute()
      await sql`
        UPDATE images SET position = arranged.position - 1, cover = coalesce(images.id = ${cover}::uuid, false)
        FROM unnest(${order}::uuid[]) WITH ORDINALITY AS arranged(id, position)
        WHERE images.id = arranged.id AND images.recipe_id = ${recipeId} AND images.owner_sub = ${ownerSub}
      `.execute(tx)
    }
    return photosOf(tx, ownerSub, recipeId)
  })
}

/**
 * **Remove** one image, a dish photo or a source photo. The photos after a
 * dish photo move up, and when it was the cover the first remaining one
 * takes over, so a version with photos keeps showing one. False means no
 * such image, or not theirs.
 */
export async function deleteImage(db: Kysely<Database>, ownerSub: string, id: string): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const image = await tx.selectFrom('images').select('recipe_id').where('id', '=', id).where('owner_sub', '=', ownerSub).executeTakeFirst()
    if (!image || !await lock(tx, ownerSub, image.recipe_id)) return false
    const deleted = await tx
      .deleteFrom('images')
      .where('id', '=', id)
      .where('owner_sub', '=', ownerSub)
      .returning(['kind', 'position', 'cover'])
      .executeTakeFirst()
    // Deleted meanwhile, by a request that held the lock first.
    if (!deleted) return false
    if (deleted.kind === 'dish') {
      await tx
        .updateTable('images')
        .set(eb => ({ position: eb('position', '-', 1) }))
        .where('recipe_id', '=', image.recipe_id)
        .where('position', '>', deleted.position!)
        .execute()
      if (deleted.cover) {
        await tx.updateTable('images').set({ cover: true }).where('recipe_id', '=', image.recipe_id).where('position', '=', 0).execute()
      }
    }
    return true
  })
}

/**
 * **Keep the source photo**: the picture a recipe was imported from, on its
 * line's root, so every version shows it. A second one replaces the first
 * under a new id, so an id's bytes never change and can be cached for good.
 */
export async function setSourcePhoto(db: Kysely<Database>, ownerSub: string, recipeId: string, upload: ImageUpload): Promise<RecipePhotos | null> {
  return db.transaction().execute(async (tx) => {
    const recipe = await lock(tx, ownerSub, recipeId)
    if (!recipe) return null
    await tx.deleteFrom('images').where('recipe_id', '=', recipe.line_id).where('kind', '=', 'source').execute()
    await tx.insertInto('images').values({
      recipe_id: recipe.line_id,
      owner_sub: ownerSub,
      kind: 'source',
      media_type: upload.mediaType,
      data: upload.data,
      thumb: upload.thumb,
    }).execute()
    return photosOf(tx, ownerSub, recipeId)
  })
}

/**
 * A new variant's copy of the source photo its parent's line has, if any: a
 * variant of a cookbook page still came from that page. Dish photos are not
 * copied; they are of attempts at the other recipe.
 */
export async function copySourcePhoto(tx: Db, ownerSub: string, parentId: string, variantId: string): Promise<void> {
  await tx
    .insertInto('images')
    .columns(['recipe_id', 'owner_sub', 'kind', 'media_type', 'data', 'thumb'])
    .expression(eb => eb
      .selectFrom('images as i')
      .innerJoin('recipes as parent', join => join.onRef('parent.line_id', '=', 'i.recipe_id').onRef('parent.owner_sub', '=', 'i.owner_sub'))
      // In the order of the columns above: INSERT ... SELECT goes by position.
      .select([uuid(variantId).as('recipe_id'), 'i.owner_sub', 'i.kind', 'i.media_type', 'i.data', 'i.thumb'])
      .where('parent.id', '=', parentId)
      .where('parent.owner_sub', '=', ownerSub)
      .where('i.kind', '=', 'source'))
    .execute()
}

/**
 * The picture a card shows for the version `alias` names, as one column of a
 * statement that has that recipes row in scope: its own cover, else the
 * newest cover anywhere in its line, so a new version does not blank the card
 * until somebody photographs it. Null when the line has none; the card then
 * falls back to the page's `image`. Restated for postgres.js in
 * server/recipes/store.ts, as lineTags is.
 */
export const cardCover = (alias: string): RawBuilder<string | null> => sql<string | null>`(
  SELECT i.id FROM images i JOIN recipes v ON v.id = i.recipe_id AND v.owner_sub = i.owner_sub
  WHERE i.cover AND v.line_id = ${sql.ref(`${alias}.line_id`)} AND v.owner_sub = ${sql.ref(`${alias}.owner_sub`)}
  ORDER BY v.id = ${sql.ref(`${alias}.id`)} DESC, i.created_at DESC
  LIMIT 1
)`
