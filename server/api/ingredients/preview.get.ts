import { requireDatabase } from '../../utils/database.ts'
import { previewQuestions } from '../../ingredients/match.ts'
import { requireOwnerSub } from '../../utils/recipes.ts'

// What opting in would ask this cook (#180), for the opt-in dialog: how many
// lines would get a question, and the pace a batch at a time would go at.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  const { ingredientBackfillBatch, ingredientBackfillHours } = useRuntimeConfig()
  return {
    questions: await previewQuestions(requireDatabase(), ownerSub),
    batch: { size: ingredientBackfillBatch, hours: ingredientBackfillHours },
  }
})
