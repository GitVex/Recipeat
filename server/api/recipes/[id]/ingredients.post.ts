import { requireDatabase } from '../../../utils/database.ts'
import { ANSWERS, answerQuestion, readQuestions, type Answer } from '../../../ingredients/answer.ts'
import { findRecipe, isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// An answer to one line's question (#173): `{ lineId, answer, ingredientId }`,
// where answer is "alias" (same thing, my name), "typo" or "none", and
// ingredientId the candidate meant (not for "none"); or "liquid" or "solid"
// for its entry (#181). Answers with the recipe, whose lines' entries and
// amounts an answer can change, and the questions left.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const body = await readBody<{ lineId?: unknown, answer?: unknown, ingredientId?: unknown }>(event)
  const { lineId, answer, ingredientId = null } = body ?? {}
  if (typeof lineId !== 'string' || !ANSWERS.includes(answer as Answer)) {
    throw createError({ statusCode: 400, message: `"lineId" has to be a line's id, and "answer" one of ${ANSWERS.join(', ')}.` })
  }
  if ((answer === 'alias' || answer === 'typo') && (typeof ingredientId !== 'string' || !/^\d+$/.test(ingredientId))) {
    throw createError({ statusCode: 400, message: '"ingredientId" has to be the candidate meant.' })
  }

  const sql = requireDatabase()
  const answered = await answerQuestion(sql, ownerSub, id, lineId, answer as Answer, ingredientId as string | null)
  // Someone else's recipe, like a question that isn't there, is absent.
  if (!answered) throw createError({ statusCode: 404, message: 'No such question.' })
  if (answered === 'und') throw createError({ statusCode: 409, message: 'This recipe’s language isn’t known, so only a typo can be answered.' })
  return { recipe: await findRecipe(sql, ownerSub, id), ...(await readQuestions(sql, ownerSub, id))! }
})
