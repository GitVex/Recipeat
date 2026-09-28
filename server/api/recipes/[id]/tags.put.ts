import { requireKysely } from '../../../utils/database.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'
import { readTags, setTags } from '../../../utils/tags.ts'

// The whole set of tags on this recipe's line, replaced. A PUT of the set
// rather than an add and a remove, so sending it twice is sending it once and
// two tabs cannot leave it half of each.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })
  const names = await readTags(event)

  const tags = await setTags(requireKysely(), ownerSub, id, names)
  if (!tags) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return { tags }
})
