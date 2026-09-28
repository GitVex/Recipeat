import { readFilters } from '../../shared/utils/recipeFilters.ts'
import { requireDatabase } from '../utils/database.ts'
import { listRecipes, requireOwnerSub } from '../utils/recipes.ts'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  // Narrowed by whatever the query string says (#14). A filter that cannot be
  // read is refused rather than dropped: a list that quietly ignored one would
  // look like an answer to a question nobody asked.
  const { filters, problems } = readFilters(getQuery(event))
  if (problems.length) throw createError({ statusCode: 400, message: problems[0] })
  // One entry per line — the pinned version. Earlier versions are reachable
  // through the lineage view and nowhere else.
  return { recipes: await listRecipes(requireDatabase(), ownerSub, filters) }
})
