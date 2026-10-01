import { requireKysely } from '../utils/database.ts'
import { readPreferences } from '../utils/preferences.ts'
import { requireOwnerSub } from '../utils/recipes.ts'

// How the signed-in person reads recipes (#62): what the server renders a
// recipe with, and what the profile's form starts from.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  return { preferences: await readPreferences(requireKysely(), ownerSub) }
})
