import { requireDatabase } from '../../utils/database.ts'
import { findRecipe, isRecipeId, requireOwnerSub } from '../../utils/recipes.ts'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const recipe = await findRecipe(requireDatabase(), ownerSub, id)
  // Someone else's recipe is absent, not forbidden: whether a given id exists
  // is not theirs to learn.
  if (!recipe) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return { recipe }
})
