import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeName } from '../server/ingredients/normalize.ts'
import { searchTerms } from '../server/ingredients/terms.ts'

// The key alias lookup and alias writes share: spelling noise collapses,
// what the food is does not.

test('case, whitespace and Unicode forms collapse', () => {
  for (const name of [' Gochujang ', 'gochujang', 'ＧＯＣＨＵＪＡＮＧ', 'Gochujang\t'])
    assert.equal(normalizeName(name, 'en'), 'gochujang', name)
  assert.equal(normalizeName('olive   oil', 'en'), 'olive oil')
})

test('diacritics and punctuation go', () => {
  assert.equal(normalizeName('Möhre', 'de'), 'mohre')
  assert.equal(normalizeName('jalapeño', 'en'), 'jalapeno')
  assert.equal(normalizeName('Gochujang-Paste', 'de'), 'gochujang paste')
  assert.equal(normalizeName('confectioners’ sugar', 'en'), 'confectioner sugar')
})

test('qualifiers that change the food stay', () => {
  assert.notEqual(normalizeName('kashmiri chili powder', 'en'), normalizeName('chili powder', 'en'))
  assert.equal(normalizeName('smoked paprika', 'en'), 'smoked paprika')
})

// [lang, plural, singular]: both sides fold to the same key.
const PLURALS = [
  ['en', 'onions', 'onion'],
  ['en', 'tomatoes', 'tomato'],
  ['en', 'cherries', 'cherry'],
  ['en', 'leaves', 'leaf'],
  ['en', 'chilies', 'chili'],
  ['en', 'chillies', 'chilli'],
  ['en', 'cookies', 'cookie'],
  ['en-US', 'yellow onions', 'yellow onion'],
  ['de', 'Zwiebeln', 'Zwiebel'],
  ['de', 'Kartoffeln', 'Kartoffel'],
  ['de', 'Tomaten', 'Tomate'],
  ['de', 'Erbsen', 'Erbse'],
  ['de', 'Eier', 'Ei'],
  ['de', 'Äpfel', 'Apfel'],
  ['de', 'Nüsse', 'Nuss'],
  ['de', 'Kräuter', 'Kraut'],
  ['de', 'Lorbeerblätter', 'Lorbeerblatt'],
] as const

test('plurals fold to their singular, per language', () => {
  for (const [lang, plural, singular] of PLURALS)
    assert.equal(normalizeName(plural, lang), normalizeName(singular, lang), `${lang} ${plural}`)
  assert.equal(normalizeName('Zwiebeln', 'de'), 'zwiebel')
})

test('a language without folding keeps its plurals', () => {
  assert.equal(normalizeName('Oignons', 'fr'), 'oignons')
  // English rules don't reach a German recipe: Butter is not Butt.
  assert.equal(normalizeName('Butter', 'de'), 'butter')
})

test('an amount left at the start of a name is dropped', () => {
  assert.equal(normalizeName('500 g flour', 'en', '500 g'), 'flour')
  assert.equal(normalizeName('2 EL Gochujang', 'de', '2 EL'), 'gochujang')
  assert.equal(normalizeName('1½ cups milk', 'en', '1½ cups'), 'milk')
  // Only as a whole leading part, and only the line's own amount.
  assert.equal(normalizeName('5 spice powder', 'en', '1 tsp'), '5 spice powder')
  assert.equal(normalizeName('500 grams', 'en', '500 g'), '500 gram')
})

test('a name with nothing left yields nothing', () => {
  for (const name of ['', '   ', '—', '()', '2 cups'])
    assert.equal(normalizeName(name, 'en', '2 cups'), null, JSON.stringify(name))
})

test('normalizing a normalized name changes nothing', () => {
  const names = [...PLURALS.flatMap(([lang, plural, singular]) => [[lang, plural], [lang, singular]]),
    ['de', 'Nüssen'], ['de', 'Hähnchen'], ['en', 'molasses'], ['en', 'hummus'], ['en', 'Brussels sprouts']]
  for (const [lang, name] of names) {
    const once = normalizeName(name, lang)!
    assert.equal(normalizeName(once, lang), once, `${lang} ${name}`)
  }
})

// Step 3a: the model's search terms (#159), against a mocked Ollama.

const ollama = { ollamaBaseUrl: 'http://ollama:11434/', ollamaModel: 'qwen3.5:2b', ollamaThreads: 4 }
const answering = (items: unknown, extra: object = {}): typeof fetch =>
  async () => Response.json({ done_reason: 'stop', message: { content: JSON.stringify({ items }) }, ...extra })

test('one call takes all the names with the language and returns terms per name', async () => {
  let sent: any
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'http://ollama:11434/api/chat')
    sent = JSON.parse(String(init!.body))
    return answering([
      { name: 'Zuccini', english: 'Zucchini', synonyms: ['courgette'], head: 'zucchini' },
      { name: 'Kashmiri-Chili', english: 'kashmiri chili', synonyms: ['red chili powder', 'chili pepper'], head: 'Chili ' },
    ])(url, init)
  }
  const result = await searchTerms(['Zuccini', 'Kashmiri-Chili'], 'de-DE', ollama, fetcher)
  assert.deepEqual(result, [
    { terms: ['zucchini', 'courgette'], head: 'zucchini' },
    { terms: ['kashmiri chili', 'red chili powder', 'chili pepper'], head: 'chili' },
  ])
  assert.equal(sent.model, 'qwen3.5:2b')
  assert.equal(sent.format.properties.items.items.properties.synonyms.maxItems, 2)
  assert.equal(sent.format.properties.items.minItems, 2)
  assert.equal(sent.format.properties.items.maxItems, 2)
  assert.deepEqual(JSON.parse(sent.messages[1].content), { language: 'de-DE', names: ['Zuccini', 'Kashmiri-Chili'] })
})

test('no misses, no call', async () => {
  assert.deepEqual(await searchTerms([], 'en', ollama, async () => assert.fail('called')), [])
})

test('down, timing out, truncated or off-schema is an error, never empty terms', async () => {
  const ask = (fetcher: typeof fetch) => searchTerms(['salt', 'flour'], 'en', ollama, fetcher)
  const good = { name: 'salt', english: 'salt', synonyms: ['table salt'], head: 'salt' }
  await assert.rejects(ask(async () => { throw new TypeError('fetch failed') }), /Could not connect/)
  await assert.rejects(ask(async () => { throw new DOMException('', 'TimeoutError') }), /in time/)
  await assert.rejects(ask(async () => new Response('busy', { status: 500 })), /HTTP 500/)
  await assert.rejects(ask(answering([good, good], { done_reason: 'length' })), /before finishing/)
  await assert.rejects(ask(async () => Response.json({ message: { content: 'Sure! salt, flour' } })), /invalid JSON/)
  await assert.rejects(ask(answering([good])), /1 of 2/)
  await assert.rejects(ask(answering([good, { name: 'flour', english: 'flour', synonyms: [], head: 'flour' }])), /outside the schema/)
  await assert.rejects(ask(answering([good, { name: 'flour', english: 'flour', synonyms: ['wheat flour'], head: ' ' }])), /outside the schema/)
})
