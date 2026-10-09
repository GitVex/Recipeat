import { requireDatabase } from '../../../utils/database.ts'
import { readQuestions } from '../../../ingredients/answer.ts'
import { isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// The close matches this recipe's owner is asked about (#173), and the
// recipe's language, which decides the answers they can give.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const questions = await readQuestions(requireDatabase(), ownerSub, id)
  if (!questions) throw createError({ statusCode: 404, message: 'No such recipe.' })
  return questions
})
