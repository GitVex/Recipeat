import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_TAG_NAME, MAX_TAGS, validateTags } from '../server/tags/validate.ts'

// A recipe's tags from a request body: tidied, folded together when they are
// one tag in two cases, and refused for anything the table would refuse.
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

test('names come back trimmed, with inner whitespace made one space', () => {
  assert.deepEqual(validateTags({ tags: ['  quick\t', 'weeknight   dinner', 'two\nlines'] }), ['quick', 'weeknight dinner', 'two lines'])
  assert.deepEqual(validateTags({ tags: [] }), [])
})

test('one tag in two cases is kept once, as first given', () => {
  assert.deepEqual(validateTags({ tags: ['Quick', 'vegan', 'QUICK', ' quick '] }), ['Quick', 'vegan'])
})

test('anything but an array of strings is a 400', () => {
  for (const body of [{}, { tags: 'quick' }, { tags: ['quick', 3] }, { tags: [null] }, ['quick'], null, 'quick'])
    assert.throws(() => validateTags(body), status(400), JSON.stringify(body))
})

test('an empty name, or one with a control character in it, is a 400', () => {
  for (const tags of [[''], ['   '], ['qu\u0000ick'], ['qu\u0085ick']])
    assert.throws(() => validateTags({ tags }), status(400), JSON.stringify(tags))
})

test('a name is at most 40 characters, counted as Postgres counts them', () => {
  assert.equal(validateTags({ tags: ['x'.repeat(MAX_TAG_NAME)] })[0]!.length, MAX_TAG_NAME)
  assert.throws(() => validateTags({ tags: ['x'.repeat(MAX_TAG_NAME + 1)] }), status(413))
  assert.equal([...validateTags({ tags: ['🌶'.repeat(MAX_TAG_NAME)] })[0]!].length, MAX_TAG_NAME)
})

test('a recipe has at most 20 tags, counted after folding', () => {
  const many = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `tag ${i}`)
  assert.throws(() => validateTags({ tags: many }), status(413))
  assert.equal(validateTags({ tags: [...many.slice(1), 'TAG 1'] }).length, MAX_TAGS)
})
