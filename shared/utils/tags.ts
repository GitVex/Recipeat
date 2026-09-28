// The rules for a tag's name, shared so the editor stops where the server
// would refuse. The ceilings are a chip's and a card's, not storage limits.
export const MAX_TAG_NAME = 40
export const MAX_TAGS = 20

// C0 and C1, which is what [[:cntrl:]] refuses in 003_tags.sql.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * A name as it is kept: trimmed, and inner runs of whitespace made one space,
 * so "weeknight  dinner" and "weeknight dinner" are not two tags. Case is
 * left alone — it is folded where names are compared, not where they are
 * stored.
 */
export const tidyTagName = (name: string) => name.trim().replace(/\s+/g, ' ')

// What is wrong with a name once tidied, in words a person can act on, or
// null when nothing is. Control characters are the one thing tidying cannot
// fix, since a tab or a newline inside a name has already become a space.
export function tagNameProblem(name: string): string | null {
  if (!name) return 'A tag needs a name.'
  if (CONTROL.test(name)) return 'A tag is one line of text.'
  if ([...name].length > MAX_TAG_NAME) return `A tag is limited to ${MAX_TAG_NAME} characters.`
  return null
}

// Compared as Postgres compares them for tags_owner_name_idx.
export const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
