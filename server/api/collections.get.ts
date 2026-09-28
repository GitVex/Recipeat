import { requireKysely } from '../utils/database.ts'
import { listCollections } from '../utils/collections.ts'
import { requireOwnerSub } from '../utils/recipes.ts'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  // Each with its count and first four thumbnails, so neither the page nor
  // the header reads anything else per collection.
  return { collections: await listCollections(requireKysely(), ownerSub) }
})
