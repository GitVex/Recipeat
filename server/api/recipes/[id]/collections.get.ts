import { requireKysely } from '../../../utils/database.ts'
import { collectionsContaining } from '../../../utils/collections.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// Which collections this version is in, as ids: the ticks in the picker, set
// against the list from GET /api/collections.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const collections = await collectionsContaining(requireKysely(), ownerSub, id)
  if (!collections) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return { collections }
})
