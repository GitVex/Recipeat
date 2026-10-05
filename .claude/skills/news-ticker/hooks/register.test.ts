import { expect, test } from 'claude-code/testing'

import { ago, isRecent, isWanted, itemsOf, stripOf, topicsOf } from './register'

test('decodes hex and astral character references', () => {
  const [i] = itemsOf('<item><title>It&#x2019;s &#X1F600; &#8212; ok</title></item>')
  expect(i!.title).toBe('It’s \u{1F600} — ok')
})

test('keeps headlines from the last 6 hours, and undated ones', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  expect(isRecent(Date.parse('2026-10-05T06:00:00Z'), now)).toBe(true)
  expect(isRecent(Date.parse('2026-10-05T05:59:00Z'), now)).toBe(false)
  expect(isRecent(NaN, now)).toBe(true)
})

test('works out headline ages when drawn', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  const list = [
    { title: 'A', outlet: 'X', published: now - 20 * 60_000 },
    { title: 'B', outlet: 'Y', published: null },
  ]
  expect(stripOf(list, now)).toBe('A [X, 20 min ago]  •  B [Y]  •  ')
  expect(stripOf(list, now + 40 * 60_000)).toBe('A [X, 1 hour ago]  •  B [Y]  •  ')
})

test('reads titles and dates from RSS and RDF items', () => {
  const xml =
    '<item><title><![CDATA[A &amp; B]]></title><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>' +
    '<item rdf:about="x"><title>C</title><dc:date>2026-10-05T08:00:00Z</dc:date></item>' +
    '<item><title>D</title></item>'
  const [a, c, d] = itemsOf(xml)
  expect(a!.title).toBe('A & B')
  expect(ago(Date.parse('2026-10-05T13:00:00Z') - a!.published)).toBe('3 hours ago')
  expect(ago(Date.parse('2026-10-05T08:20:00Z') - c!.published)).toBe('20 min ago')
  expect(Number.isNaN(d!.published)).toBe(true)
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
