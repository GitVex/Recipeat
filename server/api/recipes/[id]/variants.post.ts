import { requireKysely } from '../../../utils/database.ts'
import { normalizeRecipe, parseExtraction } from '../../../utils/extraction.ts'
import { insertVariant, isRecipeId, readRecipeBody, requireOwnerSub } from '../../../utils/recipes.ts'

// Save as Variant: a different take that stands on its own. The id in the path
// is what it branched off; the new recipe is the first version of a line of
// its own and does not touch the pin of the line it left.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const parentId = getRouterParam(event, 'id')
  if (!isRecipeId(parentId)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const { draft, source } = await readRecipeBody(event)
  const recipe = normalizeRecipe(parseExtraction(draft, source))

  const saved = await insertVariant(requireKysely(), ownerSub, parentId, recipe)
  if (!saved) throw createError({ statusCode: 404, message: 'No such recipe to branch from.' })

  setResponseStatus(event, 201)
  return { recipe: saved }
})
