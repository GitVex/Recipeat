import type { H3Event } from 'h3'
import { readJsonBody } from '../extraction/body.ts'
import { fail } from '../extraction/errors.ts'
import { MAX_TAG_NAME, MAX_TAGS, sameTag, tagNameProblem, tidyTagName } from '../../shared/utils/tags.ts'

export { MAX_TAG_NAME, MAX_TAGS }

/**
 * A recipe's whole set of tags from a request body, `{ "tags": ["…", …] }`.
 *
 * Tidied rather than refused where tidying is all it takes, and a name given
 * twice in different cases is kept once, as first given: both are what a text
 * field and a hurried person leave behind. Anything the table would refuse is
 * refused here first.
 */
export function validateTags(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail(400, 'Expected an object.')
  const { tags } = body as Record<string, unknown>
  if (!Array.isArray(tags)) throw fail(400, 'Expected tags to be an array.')
  if (!tags.every(tag => typeof tag === 'string')) throw fail(400, 'Every tag must be a string.')
  const names: string[] = []
  for (const tag of tags as string[]) {
    const name = tidyTagName(tag)
    const problem = tagNameProblem(name)
    if (problem) throw fail(name && [...name].length > MAX_TAG_NAME ? 413 : 400, problem)
    if (!names.some(kept => sameTag(kept, name))) names.push(name)
  }
  if (names.length > MAX_TAGS) throw fail(413, `A recipe is limited to ${MAX_TAGS} tags.`)
  return names
}

export async function readTags(event: H3Event): Promise<string[]> {
  return validateTags(await readJsonBody(event))
}
