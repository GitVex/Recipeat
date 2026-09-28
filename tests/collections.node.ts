import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCollectionName } from '../server/collections/validate.ts'

// A name from a request body: trimmed, then refused for anything the table
// would refuse, with a status a client can tell apart.
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

test('a name comes back trimmed', () => {
  assert.equal(validateCollectionName({ name: '  Weeknight\t' }), 'Weeknight')
  assert.equal(validateCollectionName({ name: 'Christmas 2026' }), 'Christmas 2026')
})

test('no name, or only whitespace, is a 400', () => {
  for (const body of [{}, { name: null }, { name: 3 }, { name: '' }, { name: '   ' }, null, 'Weeknight', ['Weeknight']])
    assert.throws(() => validateCollectionName(body), status(400), JSON.stringify(body))
})

test('a name is one line', () => {
  assert.throws(() => validateCollectionName({ name: 'Week\nnight' }), status(400))
  assert.throws(() => validateCollectionName({ name: 'Week\u0085night' }), status(400))
})

test('the ceiling is 80 characters, counted as Postgres counts them', () => {
  assert.equal(validateCollectionName({ name: 'x'.repeat(80) }).length, 80)
  assert.throws(() => validateCollectionName({ name: 'x'.repeat(81) }), status(413))
  // 80 emoji are 160 UTF-16 units and 80 characters: allowed.
  assert.equal([...validateCollectionName({ name: '🍲'.repeat(80) })].length, 80)
  // Surrounding whitespace does not count against it.
  assert.equal(validateCollectionName({ name: ` ${'x'.repeat(80)} ` }).length, 80)
})
