import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILTER_LIMITS, filterCount, filtersToQuery, hasFilters, NO_FILTERS, readFilters } from '../shared/utils/recipeFilters.ts'

// The listing's filters as a query string: read from one as a router or h3
// hands it over, and written back to one, the same way on both sides.

test('no query is no filters, and no filters is no query', () => {
  assert.deepEqual(readFilters({}), { filters: NO_FILTERS, problems: [] })
  assert.deepEqual(filtersToQuery(NO_FILTERS), {})
  assert.equal(hasFilters(NO_FILTERS), false)
})

test('a key once is one term, a key twice is two', () => {
  const { filters, problems } = readFilters({ q: ' leek  soup ', tag: ['Winter', 'soup'], ingredient: 'potato', maxTime: '45', minPortions: '2', maxPortions: '4', source: ['photo', 'website'] })
  assert.deepEqual(problems, [])
  assert.deepEqual(filters, { q: 'leek soup', tags: ['Winter', 'soup'], ingredients: ['potato'], maxTime: 45, minPortions: 2, maxPortions: 4, sources: ['photo', 'website'] })
  // And back again, to the same string whichever order it came in.
  assert.deepEqual(filtersToQuery(filters), { q: 'leek soup', tag: ['Winter', 'soup'], ingredient: ['potato'], maxTime: '45', minPortions: '2', maxPortions: '4', source: ['photo', 'website'] })
  assert.deepEqual(readFilters(filtersToQuery(filters)).filters, filters)
})

test('blank terms are dropped, and one term twice in two cases is kept once', () => {
  const { filters, problems } = readFilters({ tag: ['Soup', ' ', 'SOUP', 'winter'], ingredient: '', q: '   ' })
  assert.deepEqual(problems, [])
  assert.deepEqual(filters.tags, ['Soup', 'winter'])
  assert.deepEqual(filters.ingredients, [])
  assert.equal(filters.q, '')
})

test('what cannot be read is a problem, and left out', () => {
  for (const [query, left] of [
    [{ maxTime: 'soon' }, { maxTime: null }],
    [{ maxTime: '0' }, { maxTime: null }],
    [{ maxTime: '1.5' }, { maxTime: null }],
    [{ maxTime: String(60 * 24 * 30 + 1) }, { maxTime: null }],
    [{ minPortions: '-2' }, { minPortions: null }],
    [{ source: ['photo', 'fax'] }, { sources: ['photo'] }],
    [{ q: 'x'.repeat(FILTER_LIMITS.q + 1) }, { q: '' }],
    [{ tag: 'x'.repeat(FILTER_LIMITS.term + 1) }, { tags: [] }],
    [{ tag: ['ok', 3] }, { tags: ['ok'] }],
  ] as const) {
    const { filters, problems } = readFilters(query)
    assert.equal(problems.length, 1, JSON.stringify(query))
    assert.deepEqual({ ...filters, ...left }, filters, JSON.stringify(query))
  }
})

test('more terms than the ceiling is a problem, and the first ones are kept', () => {
  const many = Array.from({ length: FILTER_LIMITS.terms + 1 }, (_, i) => `tag ${i}`)
  const { filters, problems } = readFilters({ tag: many })
  assert.equal(problems.length, 1)
  assert.deepEqual(filters.tags, many.slice(0, FILTER_LIMITS.terms))
})

test('the badge counts each filter set, the search aside, and a range once', () => {
  assert.equal(filterCount(readFilters({ q: 'soup' }).filters), 0)
  assert.equal(filterCount(readFilters({ tag: ['a', 'b'], source: 'photo', maxTime: '30', minPortions: '2', maxPortions: '4' }).filters), 5)
})
