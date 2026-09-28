import { requireDatabase } from '../../utils/database.ts'
import { deleteRecipe, isRecipeId, requireOwnerSub } from '../../utils/recipes.ts'

// Delete a version and every progression descended from it. `?dryRun=true`
// answers the same way without deleting, so the UI can say how many versions
// go before any do.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  // Strict, because the mistake is costly one way only: a misspelled dry run
  // that went ahead and deleted is not a preview anyone can take back.
  const query = getQuery(event)
  const unknown = Object.keys(query).filter(key => key !== 'dryRun')
  if (unknown.length) throw createError({ statusCode: 400, message: `Unknown parameter: ${unknown.join(', ')}.` })
  if (query.dryRun !== undefined && query.dryRun !== 'true') throw createError({ statusCode: 400, message: 'dryRun can only be true.' })

  const deletion = await deleteRecipe(requireDatabase(), ownerSub, id, { dryRun: query.dryRun === 'true' })
  // Someone else's recipe is absent, not forbidden — the same answer GET gives.
  if (!deletion) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return { deletion }
})
