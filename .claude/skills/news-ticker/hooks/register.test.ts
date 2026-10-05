import { expect, test } from 'claude-code/testing'

import { ago, isWanted, itemsOf, topicsOf } from './register'

test('reads titles and dates from RSS and RDF items', () => {
  const xml =
    '<item><title><![CDATA[A &amp; B]]></title><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>' +
    '<item rdf:about="x"><title>C</title><dc:date>2026-10-05T08:00:00Z</dc:date></item>' +
    '<item><title>D</title></item>'
  const [a, c, d] = itemsOf(xml)
  expect(a.title).toBe('A & B')
  expect(ago(Date.parse('2026-10-05T13:00:00Z') - a.published)).toBe('3 hours ago')
  expect(ago(Date.parse('2026-10-05T08:20:00Z') - c.published)).toBe('20 min ago')
  expect(Number.isNaN(d.published)).toBe(true)
})

test('whitelist and blacklist match whole words, any case', () => {
  const allow = topicsOf('# comment\nUkraine\nclimate change\n')
  const deny = topicsOf('war')
  expect(isWanted('Drones over ukraine', allow, [])).toBe(true)
  expect(isWanted('Spy chief warns', allow, [])).toBe(false)
  expect(isWanted('Climate change talks stall', allow, [])).toBe(true)
  expect(isWanted('Russia warns Ukraine', allow, deny)).toBe(true)
  expect(isWanted('War in Ukraine', allow, deny)).toBe(false)
  expect(isWanted('Anything at all', [], [])).toBe(true)
})
