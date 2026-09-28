import { requireKysely } from '../../utils/database.ts'
import { deleteCollection, isCollectionId } from '../../utils/collections.ts'
import { requireOwnerSub } from '../../utils/recipes.ts'

// Deletes the collection and never a recipe in it. Nothing to preview, unlike
// deleting a recipe: what goes is the grouping, and the recipes stay where
// they were.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isCollectionId(id)) throw createError({ statusCode: 400, message: 'That is not a collection id.' })

  if (!await deleteCollection(requireKysely(), ownerSub, id)) throw createError({ statusCode: 404, message: 'No such collection.' })
  setResponseStatus(event, 204)
  return null
})
