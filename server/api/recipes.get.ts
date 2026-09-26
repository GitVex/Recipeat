import { requireDatabase } from '../utils/database.ts'
import { listRecipes, requireOwnerSub } from '../utils/recipes.ts'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  // One entry per line — the pinned version. Earlier versions are reachable
  // through the lineage view and nowhere else.
  return { recipes: await listRecipes(requireDatabase(), ownerSub) }
})
