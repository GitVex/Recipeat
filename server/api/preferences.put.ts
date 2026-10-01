import { requireKysely } from '../utils/database.ts'
import { readPreferencesBody, writePreferences } from '../utils/preferences.ts'
import { requireOwnerSub } from '../utils/recipes.ts'

// The whole set at once: the profile's form always has all of it.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)
  const preferences = await readPreferencesBody(event)
  return { preferences: await writePreferences(requireKysely(), ownerSub, preferences) }
})
