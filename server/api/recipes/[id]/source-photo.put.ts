import { requireKysely } from '../../../utils/database.ts'
import { readImageUpload, setSourcePhoto } from '../../../utils/images.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// The picture this recipe was imported from, kept with its line. Sent by the
// import dialog once the recipe is saved: extraction itself stores nothing.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })
  const upload = await readImageUpload(event)

  const photos = await setSourcePhoto(requireKysely(), ownerSub, id, upload)
  if (!photos) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return photos
})
