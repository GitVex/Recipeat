import { requireKysely } from '../../../utils/database.ts'
import { normalizeRecipe, parseExtraction } from '../../../utils/extraction.ts'
import { insertProgression, isRecipeId, readRecipeBody, requireOwnerSub } from '../../../utils/recipes.ts'

// Save as Progression: the same recipe, further along. The id in the path is
// the version it descends from — any version the caller owns, pinned or not —
// and the new one takes the pin.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const parentId = getRouterParam(event, 'id')
  if (!isRecipeId(parentId)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const { draft, source } = await readRecipeBody(event)
  const recipe = normalizeRecipe(parseExtraction(draft, source))

  const saved = await insertProgression(requireKysely(), ownerSub, parentId, recipe)
  if (!saved) throw createError({ statusCode: 404, message: 'No such recipe to progress from.' })

  setResponseStatus(event, 201)
  return { recipe: saved }
})
