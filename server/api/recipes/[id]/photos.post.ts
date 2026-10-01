import { requireKysely } from '../../../utils/database.ts'
import { addPhoto, readImageUpload } from '../../../utils/images.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// A photo of the dish, added after this version's others. Multipart, with the
// picture and its thumb as the browser made them.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })
  const upload = await readImageUpload(event)

  const photos = await addPhoto(requireKysely(), ownerSub, id, upload)
  if (!photos) throw createError({ statusCode: 404, message: 'No such recipe.' })
  setResponseStatus(event, 201)
  return photos
})
