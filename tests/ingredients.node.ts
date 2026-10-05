import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeName } from '../server/ingredients/normalize.ts'

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
