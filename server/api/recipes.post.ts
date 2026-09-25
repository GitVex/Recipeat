import { requireKysely } from '../utils/database.ts'
import { normalizeRecipe, parseExtraction } from '../utils/extraction.ts'
import { insertRecipe, readRecipeBody, requireOwnerSub } from '../utils/recipes.ts'

export default defineEventHandler(async (event) => {
  // Set before the session check, so the 401 carries it too.
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const { draft, source } = await readRecipeBody(event)
  // Validation happened above, in something written for untrusted input. This
  // is the same assembly the extraction routes run: it rebuilds ingredient
  // ids, step parts and the links between them from the text, so a stored
  // recipe and an extracted one are the same shape by construction.
  const recipe = normalizeRecipe(parseExtraction(draft, source))

  setResponseStatus(event, 201)
  return { recipe: await insertRecipe(requireKysely(), ownerSub, recipe) }
})
