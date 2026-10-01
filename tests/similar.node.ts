import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowSearch, candidates, searchQuery, similarTo } from '../server/recipes/similar.ts'

// "Similar recipes elsewhere" (#59): what is kept from a SearXNG answer.
const answer = {
  results: [
    { url: 'https://www.recipetineats.com/carbonara/', title: 'Carbonara', content: 'Classic.' },
    { url: 'https://recipetineats.com/carbonara', title: 'The same page again' },
    { url: 'javascript:alert(1)', title: 'Not a link' },
    { url: 'https://example.com/no-title', title: '  ' },
    { url: 'https://cooking.nytimes.com/recipes/12965', title: 'NYT Carbonara' },
    { url: 'https://simplyrecipes.com/carbonara?ref=x', title: 'Simply Carbonara' },
    { url: 'https://bbcgoodfood.com/carbonara', title: 'BBC Carbonara' },
  ],
}

test('only http(s) links with a title, once per page, site without www.', () => {
  const found = candidates(answer)
  assert.deepEqual(found.map(result => result.site), ['recipetineats.com', 'cooking.nytimes.com', 'simplyrecipes.com', 'bbcgoodfood.com'])
  assert.equal(found[0].snippet, 'Classic.')
  assert.equal(found[1].snippet, '')
})

test('three at most, and never the page the recipe came from', () => {
  const found = candidates(answer)
  assert.equal(similarTo(found, [null]).length, 3)
  const shown = similarTo(found, ['http://recipetineats.com/carbonara/', undefined])
  assert.deepEqual(shown.map(result => result.site), ['cooking.nytimes.com', 'simplyrecipes.com', 'bbcgoodfood.com'])
})

test('a malformed answer is a 502, not an empty list', () => {
  assert.throws(() => candidates({}), { statusCode: 502 })
})

test('the query says recipe in the recipe’s language', () => {
  assert.equal(searchQuery('Carbonara', 'de'), 'Carbonara Rezept')
  assert.equal(searchQuery('Carbonara', 'xx'), 'Carbonara recipe')
})

test('thirty searches an hour per user, then a fresh window', () => {
  const start = 1_000_000
  for (let i = 0; i < 30; i++) assert.ok(allowSearch('a', start))
  assert.equal(allowSearch('a', start), false)
  assert.ok(allowSearch('b', start))
  assert.ok(allowSearch('a', start + 60 * 60 * 1000))
})
