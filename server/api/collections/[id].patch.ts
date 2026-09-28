import { requireKysely } from '../../utils/database.ts'
import { isCollectionId, readCollectionName, renameCollection } from '../../utils/collections.ts'
import { requireOwnerSub } from '../../utils/recipes.ts'

// Rename. A PATCH because the name is the one thing about a collection that
// can change here; what is in it is #69's.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isCollectionId(id)) throw createError({ statusCode: 400, message: 'That is not a collection id.' })

  const name = await readCollectionName(event)
  const collection = await renameCollection(requireKysely(), ownerSub, id, name)
  // Someone else's collection is absent, not forbidden, as a recipe is.
  if (!collection) throw createError({ statusCode: 404, message: 'No such collection.' })
  return { collection }
})
