import type { H3Event } from 'h3'
import { sql, type Kysely } from 'kysely'
import { json, type Database } from '../database/schema.ts'
import { readJsonBody } from '../extraction/body.ts'
import { fail } from '../extraction/errors.ts'
import { groupProblem, isPreferenceValue, PREFERENCE_KEYS, PREFERENCE_SPECS, preferenceRule, type Preferences } from '../../shared/utils/preferences.ts'

/**
 * A whole set of preferences from a request body: every key in PREFERENCES,
 * each something it may hold or null, and nothing else. Every key is required,
 * so a body that forgot one does not quietly unset it. Then every group's
 * check across its keys (#200).
 */
export function validatePreferences(body: unknown): Preferences {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail(400, 'Expected an object.')
  const given = body as Record<string, unknown>
  for (const key of Object.keys(given))
    if (!PREFERENCE_KEYS.includes(key as never)) throw fail(400, `There is no preference called ${key}.`)
  for (const key of PREFERENCE_KEYS) {
    const spec = PREFERENCE_SPECS[key]
    if (!(key in given) || !isPreferenceValue(spec, given[key])) throw fail(400, `${key} must be ${preferenceRule(spec)}.`)
  }
  const preferences = Object.fromEntries(PREFERENCE_KEYS.map(key => [key, given[key]])) as Preferences
  const problem = groupProblem(preferences)
  if (problem) throw fail(400, problem)
  return preferences
}

export async function readPreferencesBody(event: H3Event): Promise<Preferences> {
  return validatePreferences(await readJsonBody(event))
}

/**
 * Stored settings as the config has them now: a key it no longer has is left
 * out, and one it has not seen yet — or whose options have changed under it —
 * reads as unset.
 */
function fromSettings(settings: Record<string, unknown>): Preferences {
  return Object.fromEntries(PREFERENCE_KEYS.map((key) => {
    const value = settings[key] ?? null
    return [key, isPreferenceValue(PREFERENCE_SPECS[key], value) ? value : null]
  })) as Preferences
}

/** The owner's preferences; none saved yet reads as none set. */
export async function readPreferences(db: Kysely<Database>, ownerSub: string): Promise<Preferences> {
  const row = await db.selectFrom('preferences')
    .select('settings')
    .where('owner_sub', '=', ownerSub)
    .executeTakeFirst()
  return fromSettings(row?.settings ?? {})
}

/** Replaces the owner's whole set, and answers it as stored. */
export async function writePreferences(db: Kysely<Database>, ownerSub: string, preferences: Preferences): Promise<Preferences> {
  const row = await db.insertInto('preferences')
    .values({ owner_sub: ownerSub, settings: json(preferences) })
    .onConflict(conflict => conflict.column('owner_sub').doUpdateSet({ settings: json(preferences), updated_at: sql`now()` }))
    .returning('settings')
    .executeTakeFirstOrThrow()
  return fromSettings(row.settings)
}
