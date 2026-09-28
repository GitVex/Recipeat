import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import { describeChanges, MAX_ITEMS, recipeChanges, snippet } from '../shared/utils/recipeDiff.ts'

// How two versions of a recipe differ, counted (#31). Built through the same
// assembly a save runs, so the ids are the positional ones a stored recipe
// really has — which is why nothing here may match on them.
type Draft = { title?: string, portions?: number | null, totalTime?: number | null, ingredients?: string[], steps?: string[] }
const recipe = ({ title = 'Bread', portions = 2, totalTime = null, ingredients = ['500 g flour', '10 g salt', '350 ml water'], steps = ['Mix.', 'Knead for 10 minutes.', 'Bake.'] }: Draft = {}) =>
  normalizeRecipe(parseExtraction({
    title, source_lang: 'en', portions, totalTime,
    // "text|name" where the name is not simply what follows the amount.
    ingredients: ingredients.map((entry) => {
      const [line, named] = entry.split('|') as [string, string | undefined]
      const [amount, unit, ...name] = line.split(' ')
      return { originalText: line, quantity: `${amount} ${unit}`, name: named ?? name.join(' ') }
    }),
    steps,
  }, { type: 'text', originalText: '' }))

const none = { added: 0, removed: 0, changed: 0 }
// The counts of a list of changes, without its items.
const counts = ({ added, removed, changed }: { added: number, removed: number, changed: number }) => ({ added, removed, changed })

test('a copy is no change at all', () => {
  const changes = recipeChanges(recipe(), recipe())
  assert.deepEqual(changes, {
    title: false, portions: null, totalTime: null,
    ingredients: { ...none, items: [] }, steps: { ...none, items: [] },
  })
  assert.deepEqual(describeChanges(changes), [])
})

test('ingredients are matched by name, not by id or position', () => {
  // Salt moved to the front: every id shifted, and nothing changed.
  const moved = recipe({ ingredients: ['10 g salt', '500 g flour', '350 ml water'] })
  assert.deepEqual(counts(recipeChanges(recipe(), moved).ingredients), none)

  const edited = recipe({ ingredients: ['500 g flour', '12 g salt', '5 g yeast'] })
  assert.deepEqual(counts(recipeChanges(recipe(), edited).ingredients), { added: 1, removed: 1, changed: 1 })
})

test('a name that appears twice pairs twice', () => {
  const twice = recipe({ ingredients: ['200 g butter', '100 g sugar', '50 g butter'] })
  const same = recipe({ ingredients: ['50 g butter', '100 g sugar', '200 g butter'] })
  // Paired in order: 200 g with 50 g and back — both read differently.
  assert.deepEqual(counts(recipeChanges(twice, same).ingredients), { added: 0, removed: 0, changed: 2 })
  assert.deepEqual(counts(recipeChanges(twice, recipe({ ingredients: ['200 g butter', '100 g sugar'] })).ingredients), { added: 0, removed: 1, changed: 0 })
})

test('steps are matched by text, and the rest paired as changed', () => {
  const reworded = recipe({ steps: ['Mix.', 'Knead for 15 minutes.', 'Bake.'] })
  assert.deepEqual(counts(recipeChanges(recipe(), reworded).steps), { added: 0, removed: 0, changed: 1 })
  // Reordered only: nothing to count.
  assert.deepEqual(counts(recipeChanges(recipe(), recipe({ steps: ['Knead for 10 minutes.', 'Mix.', 'Bake.'] })).steps), none)
  const longer = recipe({ steps: ['Mix.', 'Knead for 10 minutes.', 'Rest for an hour.', 'Shape.', 'Bake.'] })
  assert.deepEqual(counts(recipeChanges(recipe(), longer).steps), { added: 2, removed: 0, changed: 0 })
  const shorter = recipe({ steps: ['Mix and bake.'] })
  assert.deepEqual(counts(recipeChanges(recipe(), shorter).steps), { added: 0, removed: 2, changed: 1 })
})

test('whitespace and case are not changes', () => {
  const tidied = recipe({ title: '  bread ', ingredients: ['500 g Flour', '10 g salt', '350 ml  water'], steps: ['mix.', 'Knead for 10 minutes.', 'Bake.'] })
  const changes = recipeChanges(recipe(), tidied)
  assert.equal(changes.title, false)
  assert.deepEqual(counts(changes.ingredients), none)
  assert.deepEqual(counts(changes.steps), none)
})

test('the title, portions and time are compared as they stand', () => {
  const changes = recipeChanges(recipe({ totalTime: 45 }), recipe({ title: 'Rye bread', portions: 4, totalTime: 90 }))
  assert.equal(changes.title, true)
  assert.deepEqual(changes.portions, [2, 4])
  assert.deepEqual(changes.totalTime, [45, 90])
  assert.deepEqual(recipeChanges(recipe({ portions: null }), recipe()).portions, [null, 2])
})

test('described most telling first, in words a card can carry', () => {
  const changes = recipeChanges(
    recipe({ totalTime: 45 }),
    recipe({
      title: 'Rye bread', portions: 4, totalTime: 90,
      ingredients: ['500 g rye', '12 g salt', '350 ml water', '5 g yeast'],
      steps: ['Mix.', 'Knead for 15 minutes.', 'Bake.', 'Cool.'],
    }),
  )
  assert.deepEqual(describeChanges(changes), [
    'Renamed', '+2 ingredients', '−1 ingredient', '1 ingredient changed', '+1 step', '1 step changed', 'Serves 2 → 4', '45 min → 1 h 30 min',
  ])
  assert.deepEqual(describeChanges(recipeChanges(recipe(), recipe({ portions: null }))), ['Serves 2 → ?'])
})

test('an ingredient says what it was, what it is, and by how much', () => {
  // From a real line: butter and olive oil raised, the rest untouched.
  const before = recipe({ ingredients: ['6 tablespoons unsalted butter', '4 tablespoons olive oil', '1 teaspoon sugar', '4 cloves garlic'] })
  const after = recipe({ ingredients: ['8 tablespoons unsalted butter', '15 tablespoons olive oil', '1 teaspoon sugar', '3 cloves garlic', '5 g yeast'] })
  const { items } = recipeChanges(before, after).ingredients
  assert.deepEqual(items, [
    { kind: 'changed', name: 'unsalted butter', amount: { from: '6 tablespoons', to: '8 tablespoons', by: '+2 tbsp' }, snippet: null },
    { kind: 'changed', name: 'olive oil', amount: { from: '4 tablespoons', to: '15 tablespoons', by: '+11 tbsp' }, snippet: null },
    { kind: 'changed', name: 'garlic', amount: { from: '4 cloves', to: '3 cloves', by: '−1' }, snippet: null },
    { kind: 'added', name: 'yeast', text: '5 g yeast' },
  ])
})

test('no difference is claimed across units or ranges', () => {
  const { items } = recipeChanges(
    recipe({ ingredients: ['1 cup flour', '2-3 g salt'] }),
    recipe({ ingredients: ['250 ml flour', '4 g salt'] }),
  ).ingredients
  assert.deepEqual(items.map(item => item.kind === 'changed' && item.amount?.by), [null, null])
})

test('the same amount in different words is shown as the words', () => {
  const { items } = recipeChanges(
    recipe({ ingredients: ['2 medium onions, peeled and halved|onions'] }),
    recipe({ ingredients: ['2 medium onions, peeled and finely diced|onions'] }),
  ).ingredients
  assert.deepEqual(items, [{
    kind: 'changed', name: 'onions', amount: null,
    snippet: { before: '… medium onions, peeled and', removed: 'halved', added: 'finely diced', after: '' },
  }])
})

test('a removed ingredient is listed after what the new version has', () => {
  const { items } = recipeChanges(recipe(), recipe({ ingredients: ['350 ml water', '500 g flour'] })).ingredients
  assert.deepEqual(items, [{ kind: 'removed', name: 'salt', text: '10 g salt' }])
})

test('a changed step is numbered and cut down to the words that moved', () => {
  const long = 'Bring a large pot of water to a rolling boil. Score the tomatoes and blanch them for 30 seconds, then plunge them into ice water and peel.'
  const changed = recipeChanges(
    recipe({ steps: ['Mix.', long, 'Bake.'] }),
    recipe({ steps: ['Mix.', long.replace('30 seconds', '45 seconds'), 'Bake.', 'Cool on a rack.'] }),
  ).steps
  assert.deepEqual(changed.items, [
    { kind: 'changed', number: 2, snippet: { before: '… and blanch them for', removed: '30', added: '45', after: 'seconds, then plunge them …' } },
    { kind: 'added', number: 4, snippet: { before: '', removed: '', added: 'Cool on a rack.', after: '' } },
  ])
  const removed = recipeChanges(recipe(), recipe({ steps: ['Mix.', 'Bake.'] })).steps.items
  assert.deepEqual(removed, [{ kind: 'removed', number: 2, snippet: { before: '', removed: 'Knead for 10 minutes.', added: '', after: '' } }])
})

test('a snippet keeps a long change short', () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`)
  const cut = snippet('Start here.', words.join(' '))
  assert.equal(cut.added.split(' ').length, 15)
  assert.ok(cut.added.endsWith('…'))
})

test('the counts stay whole when the items stop', () => {
  const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => `${i + 1} g spice${i}`)
  const { ingredients } = recipeChanges(recipe({ ingredients: [] }), recipe({ ingredients: many }))
  assert.equal(ingredients.added, MAX_ITEMS + 5)
  assert.equal(ingredients.items.length, MAX_ITEMS)
})
