import { requireKysely } from '../../../../utils/database.ts'
import { addToCollection, isCollectionId } from '../../../../utils/collections.ts'
import { isRecipeId, requireOwnerSub } from '../../../../utils/recipes.ts'

// Add a version to the end of a collection. A PUT because doing it twice is
// the same as doing it once: the second finds it there and moves nothing.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isCollectionId(id)) throw createError({ statusCode: 400, message: 'That is not a collection id.' })
  const recipeId = getRouterParam(event, 'recipeId')
  if (!isRecipeId(recipeId)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const result = await addToCollection(requireKysely(), ownerSub, id, recipeId)
  if (result === 'collection') throw createError({ statusCode: 404, message: 'No such collection.' })
  // Someone else's recipe, refused by the foreign key, answers as a missing
  // one does.
  if (result === 'recipe') throw createError({ statusCode: 404, message: 'No such recipe.' })
  setResponseStatus(event, 204)
  return null
})
