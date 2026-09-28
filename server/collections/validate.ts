import type { H3Event } from 'h3'
import { readJsonBody } from '../extraction/body.ts'
import { fail } from '../extraction/errors.ts'
import { isRecipeId } from '../recipes/id.ts'

// The table's ceiling (002_collections.sql), counted the way Postgres counts:
// in characters, not UTF-16 units.
export const MAX_COLLECTION_NAME = 80

// C0 and C1, which is what [[:cntrl:]] refuses in the migration. A name is one
// line on a card and in a menu.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * A collection's name from a request body, `{ "name": "…" }`.
 *
 * Trimmed here rather than refused, because surrounding whitespace is what a
 * text field leaves behind, not a mistake worth a 400. Everything else the
 * table would refuse is refused first, with a message a person can act on.
 */
export function validateCollectionName(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail(400, 'Expected an object.')
  const { name } = body as Record<string, unknown>
  if (typeof name !== 'string') throw fail(400, 'Expected name to be a string.')
  const trimmed = name.trim()
  if (!trimmed) throw fail(400, 'A collection needs a name.')
  if (CONTROL.test(trimmed)) throw fail(400, 'A collection name is one line of text.')
  if ([...trimmed].length > MAX_COLLECTION_NAME) throw fail(413, `A collection name is limited to ${MAX_COLLECTION_NAME} characters.`)
  return trimmed
}

export async function readCollectionName(event: H3Event): Promise<string> {
  return validateCollectionName(await readJsonBody(event))
}

// More than any collection a person makes by hand; the ceiling is here so a
// request cannot hand the reorder statement an array of any length.
export const MAX_COLLECTION_ORDER = 1000

/**
 * A whole order from a request body, `{ "recipeIds": ["…", …] }`: distinct
 * recipe ids, first to last. Whether they are exactly the collection's
 * members is the store's question, asked with the collection locked.
 */
export function validateCollectionOrder(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail(400, 'Expected an object.')
  const { recipeIds } = body as Record<string, unknown>
  if (!Array.isArray(recipeIds)) throw fail(400, 'Expected recipeIds to be an array.')
  if (recipeIds.length > MAX_COLLECTION_ORDER) throw fail(413, `A collection is limited to ${MAX_COLLECTION_ORDER} recipes.`)
  if (!recipeIds.every(isRecipeId)) throw fail(400, 'Every entry in recipeIds must be a recipe id.')
  // Lowercased, because Postgres hands a uuid back lowercase and the store
  // compares these against what it read.
  const ids = recipeIds.map(id => id.toLowerCase())
  if (new Set(ids).size !== ids.length) throw fail(400, 'A recipe appears in recipeIds more than once.')
  return ids
}

export async function readCollectionOrder(event: H3Event): Promise<string[]> {
  return validateCollectionOrder(await readJsonBody(event))
}
