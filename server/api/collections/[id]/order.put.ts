import { requireKysely } from '../../../utils/database.ts'
import { isCollectionId, readCollectionOrder, reorderCollection } from '../../../utils/collections.ts'
import { requireOwnerSub } from '../../../utils/recipes.ts'

// The whole order at once. Any list but exactly the current members is a 409
// that changes nothing, rather than an order applied to part of a collection.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isCollectionId(id)) throw createError({ statusCode: 400, message: 'That is not a collection id.' })

  const recipeIds = await readCollectionOrder(event)
  const collection = await reorderCollection(requireKysely(), ownerSub, id, recipeIds)
  if (!collection) throw createError({ statusCode: 404, message: 'No such collection.' })
  return { collection }
})
