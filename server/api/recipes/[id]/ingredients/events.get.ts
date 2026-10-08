import { requireDatabase } from '../../../../utils/database.ts'
import { MATCHED } from '../../../../ingredients/match.ts'
import { readQuestions } from '../../../../ingredients/answer.ts'
import { isRecipeId, requireOwnerSub } from '../../../../utils/recipes.ts'

// Server-Sent Events (#173): "matched" each time a pass, or an answer in
// another tab, changes this recipe's links or questions, so the page reads
// them again without a reload. NOTIFY carries it from whichever app
// container did the work.
export default defineEventHandler(async (event) => {
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })
  const sql = requireDatabase()
  if (!await readQuestions(sql, ownerSub, id)) throw createError({ statusCode: 404, message: 'No such recipe.' })

  const stream = createEventStream(event)
  // postgres.js listens on one connection for every stream in this container.
  const { unlisten } = await sql.listen(MATCHED, (payload) => {
    if (payload === id) stream.push({ event: 'matched', data: id }).catch(() => {})
  })
  stream.onClosed(async () => {
    await unlisten().catch(() => {})
    await stream.close()
  })
  return stream.send()
})
