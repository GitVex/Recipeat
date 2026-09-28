import { requireDatabase } from '../../../utils/database.ts'
import { isRecipeId, pinRecipe, requireOwnerSub } from '../../../utils/recipes.ts'

// Pin: make this version the one its line is entered by. A PUT, because
// saying it twice is saying it once. No body; the version is the path.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const pin = await pinRecipe(requireDatabase(), ownerSub, id)
  if (!pin) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return pin
})
