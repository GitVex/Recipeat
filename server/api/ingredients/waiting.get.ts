import { requireDatabase } from '../../utils/database.ts'
import { countWaiting } from '../../ingredients/answer.ts'
import { requireOwnerSub } from '../../utils/recipes.ts'

// How many questions wait on this cook's recipes (#180), for the profile.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return { waiting: await countWaiting(requireDatabase(), await requireOwnerSub(event)) }
})
