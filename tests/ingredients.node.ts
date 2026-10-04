import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalAmount, matchFood, setFoods } from '../server/extraction/ingredients.ts'
import { normalizeRecipe, parseExtraction, type Unit } from '../server/utils/extraction.ts'
import { validateRecipe } from '../server/recipes/validate.ts'
import fixture from './ingredients.json' with { type: 'json' }

// The table as #132 seeded it; the app loads the same from Postgres.
setFoods(fixture as Parameters<typeof setFoods>[0])

const key = (name: string, lang = 'en') => matchFood(name, lang)?.key ?? null

test('a name matches in either language, accents and case aside', () => {
  assert.equal(key('All-Purpose Flour'), 'flour')
  assert.equal(key('Weizenmehl Type 405', 'de'), 'flour')
  assert.equal(key('Möhren', 'de'), 'carrot')
  assert.equal(key('Mohren', 'de'), 'carrot')
  assert.equal(key('confectioners’ sugar'), 'powdered_sugar')
  // An English name in a German recipe still matches.
  assert.equal(key('Cheddar', 'de-DE'), 'cheddar')
})

test('the recipe’s language decides a name both languages use', () => {
  assert.equal(key('paprika', 'en'), 'paprika')
  assert.equal(key('Paprika', 'de'), 'red_bell_pepper')
})

test('words that only describe are dropped; words that change the food are not', () => {
  assert.equal(key('large eggs'), 'egg')
  assert.equal(key('fresh basil'), 'basil')
  assert.equal(key('dried basil'), 'dried_basil')
  assert.equal(key('frischer Ingwer', 'de'), 'ginger')
  assert.equal(key('kleine rote Zwiebeln', 'de'), 'red_onion')
  assert.equal(key('butter, softened'), 'butter')
  assert.equal(key('flour (sifted)'), 'flour')
  // The food isn't always before the first comma.
  assert.equal(key('bone-in, skin-on chicken thighs'), 'chicken_thigh')
})

test('an amount left in the name is dropped like a describing word', () => {
  assert.equal(key('2 EL Mehl', 'de'), 'flour')
  assert.equal(key('1 Prise Salz', 'de'), 'salt')
  assert.equal(key('2 large eggs'), 'egg')
  assert.equal(key('3 cloves garlic'), 'garlic')
  assert.equal(key('200 g Butter', 'de'), 'butter')
})

test('a count of something unnamed is no food, even one the table has', () => {
  const spice = { key: 'cloves', form: 'solid' as const, en: ['cloves'], de: [] }
  setFoods([spice])
  try {
    assert.equal(key('cloves'), 'cloves')
    assert.equal(key('2 cloves'), null)
    assert.equal(key('2 Zehen', 'de'), null)
  } finally {
    setFoods(fixture as Parameters<typeof setFoods>[0])
  }
})

test('a food FoodData Central lacks still matches, and weighs as written', () => {
  assert.equal(key('Harissa', 'de'), 'harissa')
  assert.equal(matchFood('garam masala', 'en')!.gramsPerMl, null)
  assert.deepEqual(amount('Quark', 250, 'g', 'de'), { value: 250, maxValue: null, unit: 'g' })
  assert.equal(amount('Quark', 1, 'cup', 'de'), null)
})

test('English plurals match their singular', () => {
  assert.equal(key('tomatoes'), 'tomato')
  assert.equal(key('peaches'), 'peach')
  assert.equal(key('cherry'), 'cherries')
})

test('an unknown name matches nothing rather than its last word', () => {
  assert.equal(key('almond milk'), null)
  assert.equal(key('cooked rice'), null)
  assert.equal(key('Hafermilch', 'de'), null)
  assert.equal(key(''), null)
})

const amount = (name: string, value: number, unit: Unit, lang = 'en', maxValue: number | null = null) =>
  canonicalAmount({ value, maxValue, unit }, matchFood(name, lang)!, lang)

test('a solid comes out in grams, crossing from volume by its density', () => {
  assert.deepEqual(amount('flour', 1, 'cup'), { value: 125, maxValue: null, unit: 'g' })
  assert.deepEqual(amount('flour', 200, 'g'), { value: 200, maxValue: null, unit: 'g' })
  assert.deepEqual(amount('sugar', 1, 'kg'), { value: 1000, maxValue: null, unit: 'g' })
  // A German tablespoon is 15 ml, an American one 14.8.
  assert.deepEqual(amount('Butter', 2, 'tbsp', 'de'), { value: 28.8, maxValue: null, unit: 'g' })
  assert.deepEqual(amount('butter', 2, 'tbsp', 'en'), { value: 28.4, maxValue: null, unit: 'g' })
})

test('a liquid comes out in millilitres, crossing from weight by its density', () => {
  assert.deepEqual(amount('Milch', 250, 'ml', 'de'), { value: 250, maxValue: null, unit: 'ml' })
  assert.deepEqual(amount('milk', 1, 'cup'), { value: 236.6, maxValue: null, unit: 'ml' })
  assert.deepEqual(amount('honey', 1, 'lb'), { value: 316.6, maxValue: null, unit: 'ml' })
  assert.deepEqual(amount('water', 1, 'l', 'en', 1.5), { value: 1000, maxValue: 1500, unit: 'ml' })
})

test('nothing comes out where nothing can be worked out', () => {
  // A count, a temperature, and a crossing with no density to cross by.
  assert.equal(amount('eggs', 2, 'count'), null)
  assert.equal(amount('water', 100, 'celsius'), null)
  assert.equal(amount('chicken breast', 2, 'cup'), null)
  assert.deepEqual(amount('chicken breast', 500, 'g'), { value: 500, maxValue: null, unit: 'g' })
})

test('normalization keys each ingredient and adds its amount, leaving the written one alone', () => {
  const recipe = normalizeRecipe(parseExtraction({
    title: 'Pancakes',
    source_lang: 'en',
    portions: 2,
    ingredients: [
      { originalText: '1 cup flour', quantity: '1 cup', name: 'flour' },
      { originalText: '2 large eggs', quantity: '2', name: 'large eggs' },
      { originalText: 'a pinch of fairy dust', quantity: null, name: 'fairy dust' },
    ],
    steps: ['Mix.'],
  }, { type: 'text', originalText: 'source' }))
  const [flour, eggs, dust] = recipe.ingredients
  assert.deepEqual(flour!.quantity, { value: 1, maxValue: null, unit: 'cup' })
  assert.deepEqual(flour!.food, { key: 'flour', gramsPerMl: 0.5283 })
  assert.deepEqual(flour!.canonical, { value: 125, maxValue: null, unit: 'g' })
  assert.equal(eggs!.food!.key, 'egg')
  assert.equal(eggs!.canonical, null)
  assert.equal(dust!.food, null)
  assert.equal(dust!.canonical, null)
})

test('a key or amount a client sends is ignored and rebuilt from the name', () => {
  const recipe = normalizeRecipe(parseExtraction({
    title: 'Bread',
    source_lang: 'en',
    portions: 1,
    ingredients: [{ originalText: '1 cup flour', quantity: '1 cup', name: 'flour' }],
    steps: ['Bake.'],
  }, { type: 'text', originalText: 'source' }))
  recipe.ingredients[0]!.food = { key: 'sugar', gramsPerMl: 9 }
  recipe.ingredients[0]!.canonical = { value: 1, maxValue: null, unit: 'ml' }
  const { draft, source } = validateRecipe({ recipe })
  const saved = normalizeRecipe(parseExtraction(draft, source))
  assert.deepEqual(saved.ingredients[0]!.food, { key: 'flour', gramsPerMl: 0.5283 })
  assert.deepEqual(saved.ingredients[0]!.canonical, { value: 125, maxValue: null, unit: 'g' })
})
