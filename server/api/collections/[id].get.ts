import { requireKysely } from '../../utils/database.ts'
import { isCollectionId, readCollection } from '../../utils/collections.ts'
import { requireOwnerSub } from '../../utils/recipes.ts'

// A collection opened: its versions in order, each as the card the listing
// shows, plus whether it is still its line's pinned version.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isCollectionId(id)) throw createError({ statusCode: 400, message: 'That is not a collection id.' })

  const collection = await readCollection(requireKysely(), ownerSub, id)
  if (!collection) throw createError({ statusCode: 404, message: 'No such collection.' })
  return { collection }
})
