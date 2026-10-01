import { requireKysely } from '../../utils/database.ts'
import { deleteImage } from '../../utils/images.ts'
import { isRecipeId, requireOwnerSub } from '../../utils/recipes.ts'

// One photo removed, a dish photo or a kept source photo.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not an image id.' })

  if (!await deleteImage(requireKysely(), ownerSub, id)) throw createError({ statusCode: 404, message: 'No such image.' })
  setResponseStatus(event, 204)
  return null
})
