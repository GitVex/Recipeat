import { requireKysely } from '../../../../utils/database.ts'
import { isCollectionId, removeFromCollection } from '../../../../utils/collections.ts'
import { isRecipeId, requireOwnerSub } from '../../../../utils/recipes.ts'

// Take a version out of a collection. The recipe stays; only its place here
// goes. Not being there is not an error, as adding twice is not.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isCollectionId(id)) throw createError({ statusCode: 400, message: 'That is not a collection id.' })
  const recipeId = getRouterParam(event, 'recipeId')
  if (!isRecipeId(recipeId)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  if (!await removeFromCollection(requireKysely(), ownerSub, id, recipeId)) throw createError({ statusCode: 404, message: 'No such collection.' })
  setResponseStatus(event, 204)
  return null
})
