import { requireKysely } from '../utils/database.ts'
import { requireOwnerSub } from '../utils/recipes.ts'
import { listTags } from '../utils/tags.ts'

// Every tag the owner has on a recipe, with how many wear it: the filter's
// choices, and what the tag editor suggests.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  return { tags: await listTags(requireKysely(), ownerSub) }
})
