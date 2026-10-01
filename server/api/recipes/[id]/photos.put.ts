import { requireKysely } from '../../../utils/database.ts'
import { arrangePhotos, MAX_PHOTOS } from '../../../utils/images.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// This version's photos arranged: `order` is all of them, `cover` one of them
// or null.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const body = await readBody<{ order?: unknown, cover?: unknown }>(event)
  const order = body?.order
  const cover = body?.cover ?? null
  if (!Array.isArray(order) || order.length > MAX_PHOTOS || !order.every(isRecipeId)) {
    throw createError({ statusCode: 400, message: `"order" has to be the photos' ids, ${MAX_PHOTOS} at most.` })
  }
  if (cover !== null && !isRecipeId(cover)) throw createError({ statusCode: 400, message: '"cover" has to be a photo id or null.' })

  const photos = await arrangePhotos(requireKysely(), ownerSub, id, order, cover)
  if (!photos) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return photos
})
