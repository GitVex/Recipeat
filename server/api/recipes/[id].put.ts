import { requireDatabase } from '../../utils/database.ts'
import { normalizeRecipe, parseExtraction } from '../../utils/extraction.ts'
import { isRecipeId, readRecipeBody, requireOwnerSub, updateRecipe } from '../../utils/recipes.ts'

// Save: the recipe you had, corrected. A PUT because it replaces the row it
// names and creates nothing, which is also why it is the one of the three
// that cannot be reached by posting somewhere.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const { draft, source } = await readRecipeBody(event)
  const recipe = normalizeRecipe(parseExtraction(draft, source))

  const saved = await updateRecipe(requireDatabase(), ownerSub, id, recipe)
  // Someone else's recipe is absent rather than forbidden, and a save that
  // finds nothing is not quietly turned into a new recipe.
  if (!saved) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return { recipe: saved }
})
