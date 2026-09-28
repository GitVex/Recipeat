import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import { formatFactor, scaledPortions, scaleQuantity, stepPortions, type Scale } from '../shared/utils/recipeScale.ts'
import { anchorOf, ingredientText, partText, stepTexts } from '../shared/utils/recipeText.ts'
import type { Ingredient, Quantity } from '../shared/types/recipe.ts'

// Scaling as the recipe page prints it, from recipes built the way extraction
// builds them.
const textSource = { type: 'text', originalText: 'source' } as const
const build = (draft: Record<string, unknown>) =>
  normalizeRecipe(parseExtraction(structuredClone({ title: 'T', source_lang: 'en', portions: 4, ingredients: [], steps: [], ...draft }), textSource))
const q = (value: number, unit: Quantity['unit'], maxValue: number | null = null): Quantity => ({ value, maxValue, unit })
const by = (factor: number, anchor: string | null = null, value: number | null = null): Scale => ({ factor, anchor, value })

const pancakes = () => build({
  ingredients: [
    { originalText: '500 g flour', quantity: '500 g', name: 'flour' },
    { originalText: '3 eggs', quantity: '3', name: 'eggs' },
    { originalText: '1 1/2 cups milk', quantity: '1 1/2 cups', name: 'milk' },
    { originalText: 'salt to taste', quantity: null, name: 'salt', extra: 'to taste' },
    { originalText: '2–3 Zehen Knoblauch', quantity: '2–3 Zehen', name: 'Knoblauch' },
  ],
  steps: ['Whisk 500 g flour with the eggs, rest 20 min, then bake at 200 °C with a pinch of 5 g sugar.'],
})
const lines = (recipe: ReturnType<typeof build>, scale: Scale) =>
  recipe.ingredients.map(ingredient => ingredientText(ingredient, recipe.source_lang, 'metric', scale))
const step = (recipe: ReturnType<typeof build>, scale: Scale) => {
  const byId = new Map<string, Ingredient>(recipe.ingredients.map(ingredient => [ingredient.id, ingredient]))
  return stepTexts(recipe.steps)[0]!.parts.map(part => partText(part, recipe.steps[0]!, byId, 'en', 'metric', scale))
}

test('scaled amounts round to what a person can measure', () => {
  assert.deepEqual(scaleQuantity(q(165, 'g'), 1.5), q(250, 'g'))
  assert.deepEqual(scaleQuantity(q(3, 'count'), 1 / 3 * 1.5), q(1.5, 'count'))
  assert.deepEqual(scaleQuantity(q(1, 'count'), 1.33), q(1.5, 'count'))
  assert.deepEqual(scaleQuantity(q(1, 'cup'), 1.3), q(4 / 3, 'cup'))
  assert.deepEqual(scaleQuantity(q(1, 'tsp'), 0.1), q(1 / 8, 'tsp'))
  assert.deepEqual(scaleQuantity(q(1.2, 'kg'), 1.5), q(1.8, 'kg'))
  // Across a step between units, into the next one.
  assert.deepEqual(scaleQuantity(q(500, 'g'), 2), q(1, 'kg'))
  assert.deepEqual(scaleQuantity(q(1.2, 'kg'), 1 / 3), q(400, 'g'))
  assert.deepEqual(scaleQuantity(q(12, 'oz'), 2), q(1.5, 'lb'))
  assert.deepEqual(scaleQuantity(q(6, 'tbsp'), 2), q(12, 'tbsp'))
  // Both ends of a range.
  assert.deepEqual(scaleQuantity(q(2, null, 3), 2), q(4, null, 6))
  // An oven and a timer do not grow with the recipe.
  assert.deepEqual(scaleQuantity(q(200, 'celsius'), 2), q(200, 'celsius'))
  assert.deepEqual(scaleQuantity(q(20, 'minute'), 2), q(20, 'minute'))
  // Unscaled is untouched, not re-rounded.
  assert.deepEqual(scaleQuantity(q(247.5, 'g'), 1), q(247.5, 'g'))
})

test('servings step to whole numbers, and a factor reads as one', () => {
  assert.equal(scaledPortions(4, 1.5), 6)
  assert.equal(stepPortions(4.5, 1), 5)
  assert.equal(stepPortions(4.5, -1), 4)
  assert.equal(stepPortions(1, -1), 1)
  assert.equal(formatFactor(1.5), '×1.5')
  assert.equal(formatFactor(2 / 3), '×0.67')
})

test('portion scaling moves every amount that grows, and says which lines it could not', () => {
  const recipe = pancakes()
  const scaled = lines(recipe, by(1.5, 'portions'))
  // Metric is asked for, so the cups are shown as millilitres.
  assert.deepEqual(scaled.map(line => line.amount), ['750 g', '4½', '530 ml', null, '3–4½ Zehen'])
  assert.deepEqual(scaled.map(line => line.unscaled), [false, false, false, true, false])
  // Unscaled, nothing is marked.
  assert.ok(lines(recipe, by(1)).every(line => !line.unscaled))
})

test('a step scales what grows with the recipe and leaves the oven and the timer', () => {
  const parts = step(pancakes(), by(2, 'portions'))
  const text = parts.map(part => part.text).join('')
  assert.equal(text, 'Whisk 1 kg flour with the eggs, rest 20 min, then bake at 200 °C with a pinch of 10 g sugar.')
  assert.ok(parts.every(part => !part.unscaled))
})

test('an amount nothing says how to scale is left as written, and marked', () => {
  const recipe = pancakes()
  const measurement = Object.keys(recipe.steps[0]!.quantities).find(key => key.startsWith('mass'))!
  recipe.steps[0]!.quantities[measurement]!.scaleWithPortions = null
  const sugar = step(recipe, by(2)).find(part => part.text === '5 g')
  assert.equal(sugar?.unscaled, true)
})

test('an ingredient set by hand reads exactly as typed, and anchors the rest', () => {
  const recipe = pancakes()
  const flour = recipe.ingredients[0]!
  assert.deepEqual(anchorOf(flour, 'en', 'metric'), { value: 500, unit: 'g' })
  // 347 g of flour: the rest follows, and the flour says 347, not 345.
  const scale = by(347 / 500, flour.id, 347)
  const scaled = lines(recipe, scale)
  assert.equal(scaled[0]!.amount, '347 g')
  assert.equal(scaled[1]!.amount, '2')
  // The step restating the flour says the same.
  assert.match(step(recipe, scale).map(part => part.text).join(''), /^Whisk 347 g flour/)

  // In the other system, the anchor is set in the units shown.
  const milk = recipe.ingredients[2]!
  assert.deepEqual(anchorOf(milk, 'en', 'metric'), { value: 355, unit: 'ml' })
  assert.deepEqual(anchorOf(milk, 'en', 'imperial'), { value: 1.5, unit: 'cups' })
  // An amount with a word the parser could not place is set in that word.
  assert.deepEqual(anchorOf(recipe.ingredients[4]!, 'de', 'metric'), { value: 2, unit: 'Zehen' })
  assert.equal(anchorOf(recipe.ingredients[3]!, 'en', 'metric'), null)
})
