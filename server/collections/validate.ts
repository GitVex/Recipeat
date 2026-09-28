import type { H3Event } from 'h3'
import { readJsonBody } from '../extraction/body.ts'
import { fail } from '../extraction/errors.ts'

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
