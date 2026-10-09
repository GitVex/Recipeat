import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import {
  anchorOf, convertQuantity, formatQuantity, hasConvertible, ingredientText, isLiquid, partText, recipeSystem, resolveUnit, stepTexts,
  type UnitSystem,
} from '../shared/utils/recipeText.ts'
import type { Ingredient, IngredientEntry, Quantity, Step } from '../shared/types/recipe.ts'

// What the recipe page prints, from recipes built the way extraction builds
// them: a draft through parseExtraction and normalizeRecipe.
const textSource = { type: 'text', originalText: 'source' } as const
const build = (draft: Record<string, unknown>) =>
  normalizeRecipe(parseExtraction(structuredClone({ title: 'T', source_lang: 'en', portions: 2, ingredients: [], steps: [], ...draft }), textSource))

const stepText = (recipe: ReturnType<typeof build>, index: number, system: UnitSystem = recipeSystem(recipe)) => {
  const byId = new Map<string, Ingredient>(recipe.ingredients.map(ingredient => [ingredient.id, ingredient]))
  const step = recipe.steps[index]!
  const { number, parts } = stepTexts(recipe.steps)[index]!
  return { number, text: parts.map(part => partText(part, step, byId, recipe.source_lang, system).text).join('') }
}

const q = (value: number, unit: Quantity['unit'], maxValue: number | null = null): Quantity => ({ value, maxValue, unit })
const shown = (quantity: Quantity, lang: string, system: UnitSystem) => formatQuantity(convertQuantity(quantity, lang, system), lang)

test('amounts print in the notation their unit is measured in', () => {
  assert.equal(formatQuantity(q(1.5, 'cup'), 'en'), '1½ cups')
  assert.equal(formatQuantity(q(0.25, 'tsp'), 'en'), '¼ tsp')
  assert.equal(formatQuantity(q(1.2, 'kg'), 'de'), '1,2 kg')
  assert.equal(formatQuantity(q(2, 'count', 3), 'en'), '2–3')
  assert.equal(formatQuantity(q(180, 'celsius'), 'en'), '180 °C')
  assert.equal(formatQuantity(q(1, 'cup'), 'en'), '1 cup')
  assert.equal(formatQuantity(q(1.5, 'hour', 2.5), 'en'), '1½–2½ h')
  // A language the runtime cannot format in falls back rather than throwing.
  assert.equal(formatQuantity(q(1.25, 'g'), 'und'), '1.25 g')
})

test('an ambiguous unit is resolved from the recipe’s language', () => {
  assert.equal(resolveUnit('cup', 'en'), 'cup_us')
  assert.equal(resolveUnit('cup', 'en-US'), 'cup_us')
  assert.equal(resolveUnit('cup', 'en-GB'), 'cup_metric')
  assert.equal(resolveUnit('tbsp', 'en-AU'), 'tbsp_au')
  assert.equal(resolveUnit('tsp', 'de'), 'tsp_metric')
  assert.equal(resolveUnit('fl_oz', 'en-GB'), 'fl_oz_imperial')
  assert.equal(resolveUnit('g', 'en'), 'g')
})

test('imperial amounts read as metric ones, rounded the way a kitchen measures', () => {
  assert.equal(shown(q(4, 'lb'), 'en', 'metric'), '1.8 kg')
  assert.equal(shown(q(8, 'oz'), 'en', 'metric'), '225 g')
  assert.equal(shown(q(1.5, 'cup'), 'en', 'metric'), '355 ml')
  assert.equal(shown(q(1, 'cup'), 'en-GB', 'metric'), '250 ml')
  assert.equal(shown(q(350, 'fahrenheit'), 'en', 'metric'), '175 °C')
  assert.equal(shown(q(0.25, 'inch'), 'en', 'metric'), '6.4 mm')
  // Both ends of a range in the same unit, chosen by the larger.
  assert.equal(shown(q(2, 'lb', 3), 'en', 'metric'), '0.9–1.35 kg')
})

test('metric amounts read as imperial ones, in fractions a measuring cup has', () => {
  assert.equal(shown(q(1.2, 'kg'), 'de', 'imperial'), '2¾ lb')
  assert.equal(shown(q(120, 'g'), 'de', 'imperial'), '4¼ oz')
  assert.equal(shown(q(200, 'ml'), 'de', 'imperial'), '¾ cup')
  assert.equal(shown(q(500, 'ml'), 'de', 'imperial'), '2 cups')
  assert.equal(shown(q(30, 'ml'), 'de', 'imperial'), '2 tbsp')
  assert.equal(shown(q(5, 'ml'), 'de', 'imperial'), '1 tsp')
  assert.equal(shown(q(180, 'celsius'), 'de', 'imperial'), '355 °F')
  assert.equal(shown(q(13, 'mm'), 'en', 'imperial'), '½ in')
})

test('spoons, times and counts are the same in both systems', () => {
  for (const system of ['metric', 'imperial'] as const) {
    assert.equal(shown(q(2, 'tbsp'), 'en', system), '2 tbsp')
    assert.equal(shown(q(0.5, 'tsp'), 'de', system), '½ tsp')
    assert.equal(shown(q(20, 'minute'), 'en', system), '20 min')
    assert.equal(shown(q(3, 'count'), 'en', system), '3')
  }
  // Already in the system asked for: untouched, not re-rounded.
  assert.equal(shown(q(123, 'g'), 'de', 'metric'), '123 g')
})

test('a recipe starts in the system it was written in, and knows when there is nothing to switch', () => {
  const american = build({ ingredients: [{ originalText: '2 cups flour', quantity: '2 cups', name: 'flour' }, { originalText: '1 lb butter', quantity: '1 lb', name: 'butter' }] })
  assert.equal(recipeSystem(american), 'imperial')
  assert.equal(hasConvertible(american), true)

  const german = build({ source_lang: 'de', ingredients: [{ originalText: '1,2 kg Hähnchenfilet', quantity: '1,2 kg', name: 'Hähnchenfilet' }] })
  assert.equal(recipeSystem(german), 'metric')

  // Spoons alone: switching would change nothing, and the language decides.
  const spoons = build({ source_lang: 'en-GB', ingredients: [{ originalText: '2 tbsp oil', quantity: '2 tbsp', name: 'oil' }] })
  assert.equal(hasConvertible(spoons), false)
  assert.equal(recipeSystem(spoons), 'metric')
})

test('an ingredient prints its amount in the chosen system, and an unknown unit as written', () => {
  const recipe = build({
    source_lang: 'de',
    ingredients: [
      { originalText: '1,2 kg Hähnchenfilet', quantity: '1,2 kg', name: 'Hähnchenfilet' },
      { originalText: '4 TL Rapsöl', quantity: '4 TL', name: 'Rapsöl' },
      { originalText: '1 Zwiebel, fein gewürfelt', quantity: '1', name: 'Zwiebel', extra: 'fein gewürfelt' },
    ],
  })
  const [chicken, oil, onion] = recipe.ingredients.map(ingredient => ingredientText(ingredient, 'de', 'metric'))
  assert.deepEqual(chicken, { amount: '1,2 kg', name: 'Hähnchenfilet', extra: null, unscaled: false })
  // "TL" is not a unit the parser knows, and dropping it would leave "4 Rapsöl".
  assert.equal(oil!.amount, '4 TL')
  assert.deepEqual(onion, { amount: '1', name: 'Zwiebel', extra: 'fein gewürfelt', unscaled: false })
  assert.equal(ingredientText(recipe.ingredients[0]!, 'de', 'imperial').amount, '2¾ lb')
  assert.equal(ingredientText(recipe.ingredients[1]!, 'de', 'imperial').amount, '4 TL')
})

test('a step prints from its parts, and a restated amount comes from its ingredient', () => {
  const recipe = build({
    ingredients: [{ originalText: '2 cups flour', quantity: '2 cups', name: 'flour' }],
    steps: ['Whisk 2 cups flour with 1/2 tsp salt, then bake at 350 °F for 20 min.'],
  })
  assert.equal(stepText(recipe, 0).text, 'Whisk 2 cups flour with ½ tsp salt, then bake at 350 °F for 20 min.')
  assert.equal(stepText(recipe, 0, 'metric').text, 'Whisk 475 ml flour with ½ tsp salt, then bake at 175 °C for 20 min.')

  // The ingredient is the one place the amount lives: change it, and the step
  // follows. This is what #44 rescales.
  recipe.ingredients[0]!.quantity = q(3, 'cup')
  assert.match(stepText(recipe, 0).text, /^Whisk 3 cups flour/)
})

test('a source’s own numbering is shown once, and unnumbered steps do not take a number', () => {
  const recipe = build({
    source_lang: 'de',
    steps: [
      'Marinade: Jogurt mit Gewürzen vermengen.',
      '1. Fleisch in Marinade legen.',
      '2. Zwiebeln anbraten.',
      'Mit Reis: 1 Tasse Reis kochen.',
    ],
  })
  assert.deepEqual(
    recipe.steps.map((_, index) => stepText(recipe, index)),
    [
      { number: null, text: 'Marinade: Jogurt mit Gewürzen vermengen.' },
      { number: 1, text: 'Fleisch in Marinade legen.' },
      { number: 2, text: 'Zwiebeln anbraten.' },
      { number: null, text: 'Mit Reis: 1 Tasse Reis kochen.' },
    ],
  )
})

test('steps the source did not number are counted, and an amount is not a step number', () => {
  const recipe = build({ steps: ['1.5 kg flour into a bowl.', 'Step 2 is not numbered like this either.', 'Knead.'] })
  assert.deepEqual(stepTexts(recipe.steps).map(step => step.number), [1, 2, 3])
  assert.equal(stepText(recipe, 0, 'metric').text, '1.5 kg flour into a bowl.')

  const labelled = build({ steps: ['Step 1: Mix.', 'Schritt 2. Rühren.', '3) Bake.'] })
  assert.deepEqual([0, 1, 2].map(index => stepText(labelled, index)), [
    { number: 1, text: 'Mix.' },
    { number: 2, text: 'Rühren.' },
    { number: 3, text: 'Bake.' },
  ])
})

test('a step that is only its number, or a reference to nothing, does not break', () => {
  const step: Step = { id: 'step_1', originalText: '1.', parts: [{ type: 'text', value: '1.' }], quantities: {} }
  assert.deepEqual(stepTexts([step]), [{ number: 1, parts: [] }])
  assert.equal(partText({ type: 'ingredientQuantity', ingredientId: 'ingredient_9' }, step, new Map(), 'en', 'metric').text, '')
})

// The store's entry for a line (#181): a density, and the cooks' answer.
const entry = (densityGPerMl: number | null, answer: boolean | null = null): IngredientEntry => ({ id: '1', name: 'x', densityGPerMl, isLiquid: answer })
const weighed = (quantity: Quantity, lang: string, system: UnitSystem, of: IngredientEntry | null) => formatQuantity(convertQuantity(quantity, lang, system, of), lang)

test('in metric, a cup of something dry is weighed by its density; liquids stay in ml, spoons as written', () => {
  const flour = entry(0.53)
  assert.equal(weighed(q(1, 'cup'), 'en', 'metric', flour), '125 g')
  assert.equal(weighed(q(1, 'cup', 2), 'en', 'metric', flour), '125–250 g')
  assert.equal(weighed(q(10, 'cup'), 'en', 'metric', flour), '1.25 kg')
  assert.equal(weighed(q(4, 'fl_oz'), 'en', 'metric', flour), '63 g')
  // A spoon or a count is the same everywhere.
  assert.equal(weighed(q(2, 'tbsp'), 'en', 'metric', entry(0.85)), '2 tbsp')
  assert.equal(weighed(q(2, 'tsp'), 'de', 'metric', entry(0.85)), '2 tsp')
  assert.equal(weighed(q(2, 'count'), 'en', 'metric', flour), '2')
  // Milk is about as dense as water, so it reads as a liquid; nothing to weigh by, nothing changes.
  assert.equal(weighed(q(1, 'cup'), 'en', 'metric', entry(1.03)), '235 ml')
  assert.equal(weighed(q(1, 'cup'), 'en', 'metric', entry(null)), '235 ml')
  assert.equal(weighed(q(1, 'cup'), 'en', 'metric', null), '235 ml')
  // Millilitres are what the source measured; imperial is as it was.
  assert.equal(weighed(q(250, 'ml'), 'de', 'metric', flour), '250 ml')
  assert.equal(weighed(q(1, 'cup'), 'en', 'imperial', flour), '1 cup')
  assert.equal(weighed(q(250, 'ml'), 'de', 'imperial', flour), '1 cup')
})

test('the cooks’ answer decides what is liquid; until then the density guesses', () => {
  assert.deepEqual([0.94, 0.95, 1, 1.1, 1.11].map(d => isLiquid(entry(d))), [false, true, true, true, false])
  assert.equal(isLiquid(entry(null)), false)
  assert.equal(isLiquid(entry(0.53, true)), true)
  assert.equal(isLiquid(entry(1.03, false)), false)
  assert.equal(weighed(q(1, 'cup'), 'en', 'metric', entry(0.53, true)), '235 ml')
  assert.equal(weighed(q(1, 'cup'), 'en', 'metric', entry(1.03, false)), '245 g')
})

test('a weighed line scales, anchors in grams, and its step restates it the same', () => {
  const recipe = build({
    ingredients: [{ originalText: '1 cup flour', quantity: '1 cup', name: 'flour' }],
    steps: ['Sift 1 cup flour.'],
  })
  const flour = recipe.ingredients[0]!
  flour.ingredient = entry(0.53)
  assert.equal(ingredientText(flour, 'en', 'metric').amount, '125 g')
  assert.equal(stepText(recipe, 0, 'metric').text, 'Sift 125 g flour.')
  assert.equal(ingredientText(flour, 'en', 'metric', { factor: 2, anchor: 'portions', value: null }).amount, '250 g')
  assert.deepEqual(anchorOf(flour, 'en', 'metric'), { value: 125, unit: 'g' })
  assert.deepEqual(anchorOf(flour, 'en', 'imperial'), { value: 1, unit: 'cup' })
  // Typed as 200 g: the line says so, and the step follows it.
  const scale = { factor: 200 / 125, anchor: flour.id, value: 200 }
  assert.equal(ingredientText(flour, 'en', 'metric', scale).amount, '200 g')
  const step = recipe.steps[0]!
  assert.equal(step.parts.map(part => partText(part, step, new Map([[flour.id, flour]]), 'en', 'metric', scale).text).join(''), 'Sift 200 g flour.')
})

// Heat levels (#107): read from the words, kept as written.
const heats = (steps: string[], source_lang = 'en') =>
  build({ source_lang, steps }).steps.map(step => step.parts.flatMap(part => (part.type === 'heat' ? [[part.level, part.value]] : [])))

test('a heat level in a step becomes a heat part, and reads as written', () => {
  const recipe = build({ steps: ['Fry 200 g onions over medium-high heat until soft.'] })
  assert.deepEqual(recipe.steps[0]!.parts.map(part => part.type), ['text', 'measurement', 'text', 'heat', 'text'])
  assert.equal(stepText(recipe, 0).text, 'Fry 200 g onions over medium-high heat until soft.')
  assert.deepEqual(heats([
    'Cook over low heat.', 'Simmer on a medium-low heat.', 'Sear over High Heat.', 'Use a med-high flame.',
    'Cook over medium high heat.', 'Over medium to high heat.', 'Over moderate heat.', 'Over moderately high heat.',
    'Over a gentle heat.', 'Reduce the heat to low, then turn the heat up to medium–high.', 'Over low–medium heat.',
  ]), [
    [['low', 'low heat']], [['medium-low', 'medium-low heat']], [['high', 'High Heat']], [['medium-high', 'med-high flame']],
    [['medium-high', 'medium high heat']], [['medium-high', 'medium to high heat']], [['medium', 'moderate heat']], [['medium-high', 'moderately high heat']],
    [['low', 'gentle heat']], [['low', 'heat to low'], ['medium-high', 'heat up to medium–high']], [['medium-low', 'low–medium heat']],
  ])
})

test('German steps are read with German words', () => {
  assert.deepEqual(heats([
    'Bei mittlerer Hitze anbraten.', 'Bei schwacher Hitze köcheln.', 'Bei starker Hitze scharf anbraten.',
    'Bei mittlerer bis starker Hitze braten.', 'Auf kleiner Flamme ziehen lassen.', 'Bei hoher Hitze.', 'Auf mittlere Stufe stellen.',
    'Bei großer Hitze.', 'Bei mäßiger Hitze.',
  ], 'de'), [
    [['medium', 'mittlerer Hitze']], [['low', 'schwacher Hitze']], [['high', 'starker Hitze']],
    [['medium-high', 'mittlerer bis starker Hitze']], [['low', 'kleiner Flamme']], [['high', 'hoher Hitze']], [['medium', 'mittlere Stufe']],
    [['high', 'großer Hitze']], [['medium', 'mäßiger Hitze']],
  ])
})

test('states, other words and other languages stay plain text', () => {
  assert.deepEqual(heats([
    'Bring to a simmer.', 'Cook until boiling.', 'Heat the oil.', 'Use low-fat milk.', 'Bake on the high shelf.',
    'Slow heat is best.', 'Over low to high heat.', 'Heat the oven to 200 °C.', 'Keep at a rolling boil.',
  ]), [[], [], [], [], [], [], [], [], []])
  // The words are English, the recipe is not: no list, no parts.
  assert.deepEqual(heats(['Over medium heat.'], 'fr'), [[]])
  assert.deepEqual(heats(['Over medium heat.'], 'und'), [[]])
  assert.deepEqual(heats(['Bei mittlerer Hitze.'], 'en'), [[]])
  // A region on the language still finds it.
  assert.deepEqual(heats(['Over medium heat.'], 'en-GB'), [[['medium', 'medium heat']]])
})

test('heat parts are rebuilt from the text, never taken from a client', () => {
  // A posted step is a string; parts sent beside it are not read.
  const recipe = normalizeRecipe(parseExtraction({ title: 'T', source_lang: 'en', portions: 2, ingredients: [], steps: ['Stir well.'], parts: [{ type: 'heat', level: 'high', value: 'x' }] }, textSource))
  assert.deepEqual(recipe.steps[0]!.parts, [{ type: 'text', value: 'Stir well.' }])
  assert.throws(() => parseExtraction({ title: 'T', source_lang: 'en', portions: 2, ingredients: [], steps: [{ type: 'heat', level: 'high', value: 'high heat' }] }, textSource))
})

test('scaling leaves a heat part as written', () => {
  const recipe = build({ steps: ['Fry 200 g onions over high heat.'] })
  const step = recipe.steps[0]!
  const heat = step.parts.find(part => part.type === 'heat')!
  assert.deepEqual(partText(heat, step, new Map(), 'en', 'metric', { factor: 3, anchor: null } as never), { text: 'high heat', amount: false, unscaled: false })
})
