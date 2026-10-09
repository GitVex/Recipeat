import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLink, NOT_A_WEB_LINK } from '../shared/utils/importLink.ts'

// What follows /get/ in a prefix link (#136), as the page reads it raw.
test('the address comes through whole, its own query and fragment included', () => {
  const url = 'https://itsnotaboutnutrition.com/teriyaki/?print=1&servings=4#recipe'
  assert.deepEqual(importLink(url), { url, error: '' })
  assert.deepEqual(importLink('http://example.com/a'), { url: 'http://example.com/a', error: '' })
})

test('a folded or encoded scheme is put back', () => {
  assert.equal(importLink('https:/example.com/a?b=c').url, 'https://example.com/a?b=c')
  assert.equal(importLink('HTTPS:example.com/a').url, 'HTTPS://example.com/a')
  assert.equal(importLink('https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc').url, 'https://example.com/a?b=c')
})

test('nothing opens the dialog empty, and anything not http(s) says why', () => {
  assert.deepEqual(importLink(''), { url: '', error: '' })
  for (const raw of ['javascript:alert(1)', 'ftp://example.com/a', 'example.com/a', 'data:text/html,x', 'https%3A%ZZ'])
    assert.deepEqual(importLink(raw), { url: '', error: NOT_A_WEB_LINK }, raw)
})
