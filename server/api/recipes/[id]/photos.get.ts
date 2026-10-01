import { requireKysely } from '../../../utils/database.ts'
import { listPhotos } from '../../../utils/images.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// This version's photos in order, and its line's source photo.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const photos = await listPhotos(requireKysely(), ownerSub, id)
  if (!photos) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return photos
})
