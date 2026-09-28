import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import { validateRecipe } from '../server/recipes/validate.ts'
import { blankIngredient, blankStep, bodyOf, editOf, isEdited, parseMinutes, parsePortions } from '../shared/utils/recipeDraft.ts'

// The editor's half of a save: a recipe into editable text, and edited text
// into a body the server accepts. Each body is run through validateRecipe and
// the same assembly the routes use, so "accepted" means what it will mean.
const textSource = { type: 'text', originalText: 'source' } as const
const build = (draft: Record<string, unknown>) =>
  normalizeRecipe(parseExtraction(structuredClone({ title: 'Stew', source_lang: 'de', portions: 4, totalTime: 90, ingredients: [], steps: [], ...draft }), textSource))
const saved = (body: unknown) => {
  const { draft, source } = validateRecipe({ recipe: body })
  return normalizeRecipe(parseExtraction(draft, source))
}

const stew = () => build({
  ingredients: [
    { originalText: '1,2 kg Rindfleisch', quantity: '1,2 kg', name: 'Rindfleisch' },
    { originalText: '2 Zwiebeln, gewürfelt', quantity: '2', name: 'Zwiebeln', extra: 'gewürfelt' },
  ],
  steps: ['Vorbereitung: alles bereitlegen.', '1. Fleisch anbraten.', '2. 200 ml Wasser dazu.'],
})

test('durations and portions are read the way people write them', () => {
  for (const [text, minutes] of [['45', 45], ['45 min', 45], ['1 h 30 min', 90], ['1.5 h', 90], ['1,5 Std', 90], ['2h30', 150], ['1:30', 90], ['2 hours', 120]] as const) {
    assert.equal(parseMinutes(text), minutes, text)
  }
  assert.equal(parseMinutes(''), null)
  assert.equal(parseMinutes('a while'), undefined)
  assert.equal(parseMinutes('0'), undefined)
  assert.equal(parsePortions('4,5'), 4.5)
  assert.equal(parsePortions(''), null)
  assert.equal(parsePortions('four'), undefined)
  assert.equal(parsePortions('0'), undefined)
})

test('a recipe opens as the text a person would edit, numbers off its steps', () => {
  const edit = editOf(stew())
  assert.equal(edit.title, 'Stew')
  assert.equal(edit.portions, '4')
  assert.equal(edit.totalTime, '1 h 30 min')
  assert.deepEqual(edit.ingredients.map(({ amount, name, extra }) => ({ amount, name, extra })), [
    { amount: '1,2 kg', name: 'Rindfleisch', extra: '' },
    { amount: '2', name: 'Zwiebeln', extra: 'gewürfelt' },
  ])
  assert.deepEqual(edit.steps.map(({ text, number }) => ({ text, number })), [
    { text: 'Vorbereitung: alles bereitlegen.', number: null },
    { text: 'Fleisch anbraten.', number: 1 },
    { text: '200 ml Wasser dazu.', number: 2 },
  ])
  // A recipe that numbered nothing keeps "2 eggs" as the start of its step.
  const eggs = editOf(build({ steps: ['2 Eier verquirlen.'] }))
  assert.equal(eggs.steps[0]!.text, '2 Eier verquirlen.')
})

test('an unedited recipe goes back unchanged and is not marked as edited', () => {
  const recipe = stew()
  const edit = editOf(recipe)
  assert.equal(isEdited(recipe, edit), false)
  const { body } = bodyOf(recipe, edit)
  assert.deepEqual(saved(body), recipe)
})

test('an edited amount is sent as text, and the server reads it and re-links the step', () => {
  const recipe = build({
    source_lang: 'en',
    ingredients: [{ originalText: '1 cup milk', quantity: '1 cup', name: 'milk' }],
    steps: ['Warm 1 cup milk.'],
  })
  const edit = editOf(recipe)
  edit.ingredients[0]!.amount = '2 cups'
  edit.steps[0]!.text = 'Warm 2 cups milk gently.'
  assert.equal(isEdited(recipe, edit), true)
  const result = saved(bodyOf(recipe, edit).body)
  assert.deepEqual(result.ingredients[0]!.quantity, { value: 2, maxValue: null, unit: 'cup' })
  assert.equal(result.ingredients[0]!.originalText, '2 cups milk')
  assert.deepEqual(result.steps[0]!.parts[1], { type: 'ingredientQuantity', ingredientId: 'ingredient_1' })
})

test('an edited step keeps its source number while the steps keep their order', () => {
  const recipe = stew()
  const edit = editOf(recipe)
  edit.steps[1]!.text = 'Fleisch scharf anbraten.'
  edit.title = '  Rindergulasch '
  edit.portions = '6'
  edit.totalTime = '2h'
  const { body } = bodyOf(recipe, edit)
  assert.deepEqual(body!.steps, ['Vorbereitung: alles bereitlegen.', '1. Fleisch scharf anbraten.', '2. 200 ml Wasser dazu.'])
  assert.equal(body!.title, 'Rindergulasch')
  assert.equal(body!.portions, 6)
  assert.equal(body!.totalTime, 120)
})

test('once steps move, are added or removed, they are counted instead', () => {
  const recipe = stew()
  const edit = editOf(recipe)
  edit.steps.reverse()
  edit.steps.push({ ...blankStep(), text: 'Servieren.' })
  edit.steps.push(blankStep())
  assert.deepEqual(bodyOf(recipe, edit).body!.steps, ['200 ml Wasser dazu.', 'Fleisch anbraten.', 'Vorbereitung: alles bereitlegen.', 'Servieren.'])
})

test('ingredients are added, reordered and removed; a blank one is dropped', () => {
  const recipe = stew()
  const edit = editOf(recipe)
  edit.ingredients.reverse()
  edit.ingredients.push({ ...blankIngredient(), amount: '1 TL', name: 'Paprika', extra: 'edelsüß' })
  edit.ingredients.push(blankIngredient())
  const result = saved(bodyOf(recipe, edit).body)
  assert.deepEqual(result.ingredients.map(ingredient => ingredient.originalText), ['2 Zwiebeln, gewürfelt', '1,2 kg Rindfleisch', '1 TL Paprika, edelsüß'])
  assert.equal(result.ingredients[2]!.extra, 'edelsüß')
  // Moved but untouched: still the parsed amount it had.
  assert.deepEqual(result.ingredients[1]!.quantity, recipe.ingredients[0]!.quantity)
})

test('what the server would refuse is caught before it is sent', () => {
  const recipe = stew()
  const edit = editOf(recipe)
  edit.totalTime = 'a while'
  edit.portions = 'many'
  edit.ingredients = []
  edit.steps = [blankStep()]
  const { body, problems } = bodyOf(recipe, edit)
  assert.equal(body, null)
  assert.deepEqual(problems, ['totalTime', 'portions', 'empty'])

  const clear = editOf(recipe)
  clear.title = ''
  clear.portions = ''
  clear.totalTime = ''
  const cleared = bodyOf(recipe, clear).body!
  assert.equal(cleared.title, null)
  assert.equal(cleared.portions, null)
  assert.equal(cleared.totalTime, null)
  saved(cleared)
})
