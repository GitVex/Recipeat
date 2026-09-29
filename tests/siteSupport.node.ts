import assert from 'node:assert/strict'
import { test } from 'node:test'
import { siteHost, siteSupport } from '../shared/utils/siteSupport.ts'

// The dialog's hint: which of the fetcher's two ways a link will be read,
// matched the way recipe-scrapers matches a host.
const hosts = new Set(['bbcgoodfood.com', 'hellofresh.de', 'cooking.nytimes.com'])

test('a leading www. is dropped, and case and port do not matter', () => {
  assert.equal(siteHost('https://www.bbcgoodfood.com/recipes/x'), 'bbcgoodfood.com')
  assert.equal(siteHost('https://WWW.BBCGoodFood.com:443/x'), 'bbcgoodfood.com')
  assert.equal(siteSupport('http://bbcgoodfood.com/x', hosts), 'supported')
})

test('subdomains and country variants match only as listed', () => {
  assert.equal(siteSupport('https://cooking.nytimes.com/recipes/1', hosts), 'supported')
  assert.equal(siteSupport('https://nytimes.com/recipes/1', hosts), 'markup')
  assert.equal(siteSupport('https://m.bbcgoodfood.com/x', hosts), 'markup')
  assert.equal(siteSupport('https://www.hellofresh.de/r', hosts), 'supported')
  assert.equal(siteSupport('https://www.hellofresh.at/r', hosts), 'markup')
  // Only a leading www. is recipe-scrapers' to drop.
  assert.equal(siteSupport('https://www.www.bbcgoodfood.com/x', hosts), 'markup')
})

test('anything the dialog would refuse gets no hint', () => {
  for (const address of ['', 'bbcgoodfood.com', 'ftp://bbcgoodfood.com/x', 'not a url', 'javascript:alert(1)'])
    assert.equal(siteSupport(address, hosts), null, address)
})
