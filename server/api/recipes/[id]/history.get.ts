import { requireDatabase } from '../../../utils/database.ts'
import { isRecipeId, readHistory, requireOwnerSub } from '../../../utils/recipes.ts'

// The line a version belongs to, as a tree: every version in it, what
// branched off them, and what it branched off. Card fields only — reaching a
// version to read it is GET /api/recipes/{id}.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const history = await readHistory(requireDatabase(), ownerSub, id)
  if (!history) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return { history }
})
