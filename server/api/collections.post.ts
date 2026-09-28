import { requireKysely } from '../utils/database.ts'
import { createCollection, readCollectionName } from '../utils/collections.ts'
import { requireOwnerSub } from '../utils/recipes.ts'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  const name = await readCollectionName(event)

  setResponseStatus(event, 201)
  return { collection: await createCollection(requireKysely(), ownerSub, name) }
})
