import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import { validateRecipe } from '../server/recipes/validate.ts'

// What a browser sends is our own code's output handed back, so the happy path
// here is an extraction round-tripped: whatever /api/extract/* returned, minus
// nothing, posted to /api/recipes.
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

const bread = { originalText: '1 slice bread', quantity: '1 slice', name: 'bread' }
const textSource = { type: 'text', originalText: 'source' } as const
// parseExtraction takes the source as an argument; a posted recipe carries it
// as a field, because by then it is one of ours being handed back.
const draft = { title: 'Toast', source_lang: 'en', portions: 1, ingredients: [bread], steps: ['Toast the bread.'], source: textSource }
const extracted = () => normalizeRecipe(parseExtraction(structuredClone(draft), textSource))

test('an extraction handed straight back validates, and is reduced to a draft', () => {
  const { draft: validated, source } = validateRecipe({ recipe: extracted() })
  assert.equal(validated.title, 'Toast')
  assert.equal(validated.portions, 1)
  assert.deepEqual(source, textSource)
  // Reduced, not echoed: ids, parts and quantities are rebuilt on the way in.
  assert.deepEqual(Object.keys(validated.ingredients[0]!).sort(), ['extra', 'name', 'originalText', 'parsedQuantity', 'quantity'])
  assert.equal(validated.ingredients[0]!.originalText, '1 slice bread')
  assert.equal(validated.ingredients[0]!.quantity, '1 slice')
  assert.deepEqual(validated.steps, ['Toast the bread.'])
})

test('rebuilding it produces the same recipe it arrived as', () => {
  const before = extracted()
  const { draft: validated, source } = validateRecipe({ recipe: before })
  assert.deepEqual(normalizeRecipe(parseExtraction(validated, source)), before)
})

test('the envelope is optional: a bare recipe is a recipe', () => {
  assert.equal(validateRecipe(extracted()).draft.title, 'Toast')
})

test('an amount already read into numbers survives, wherever it sits', () => {
  // `cup`, not `cup_us`: amounts are stored regionally ambiguous and resolved
  // for display, so parseQuantity never produces a variant and isUnit refuses
  // one. The assertion below holds the line on that.
  const parsed = { value: 2, maxValue: 3, unit: 'cup' }
  // Normalized recipes carry the text in quantityText and the numbers in
  // quantity; drafts from the fetcher carry the text in quantity.
  const normalized = validateRecipe({ ...draft, ingredients: [{ ...bread, quantityText: '2 cups', quantity: parsed }] })
  assert.deepEqual(normalized.draft.ingredients[0]!.parsedQuantity, parsed)
  assert.equal(normalized.draft.ingredients[0]!.quantity, '2 cups')
  const fetched = validateRecipe({ ...draft, ingredients: [{ ...bread, quantity: '2 cups', parsedQuantity: parsed }] })
  assert.deepEqual(fetched.draft.ingredients[0]!.parsedQuantity, parsed)
  // An unusable amount is dropped rather than refused: the parser reads the
  // text instead, which is what happens for every ingredient the model saw.
  const nonsense = validateRecipe({ ...draft, ingredients: [{ ...bread, parsedQuantity: { value: -1, unit: 'kg' } }] })
  assert.equal(nonsense.draft.ingredients[0]!.parsedQuantity, null)
  // A resolved regional unit is reported as no unit, exactly as it is on the
  // extraction path: one stored here would never compare equal to the same
  // amount read out of a step, and the ingredient would stop rescaling with it.
  const resolved = validateRecipe({ ...draft, ingredients: [{ ...bread, parsedQuantity: { value: 2, unit: 'cup_us' } }] })
  assert.deepEqual(resolved.draft.ingredients[0]!.parsedQuantity, { value: 2, maxValue: null, unit: null })
})

test('a malformed body is refused, not recovered', () => {
  for (const body of [null, 'a recipe', 42, []]) assert.throws(() => validateRecipe(body), status(400))
  assert.throws(() => validateRecipe({ ...draft, ingredients: 'bread' }), status(400))
  assert.throws(() => validateRecipe({ ...draft, steps: { first: 'Toast it.' } }), status(400))
  assert.throws(() => validateRecipe({ ...draft, ingredients: [{ name: 'bread' }] }), status(400))
  assert.throws(() => validateRecipe({ ...draft, ingredients: [{ originalText: '  ' }] }), status(400))
  assert.throws(() => validateRecipe({ ...draft, portions: 0 }), status(400))
  assert.throws(() => validateRecipe({ ...draft, portions: 'two' }), status(400))
  assert.throws(() => validateRecipe({ ...draft, totalTime: 60 * 24 * 30 + 1 }), status(400))
  assert.throws(() => validateRecipe({ ...draft, image: 'javascript:alert(1)' }), status(400))
  assert.throws(() => validateRecipe({ ...draft, image: '/relative.png' }), status(400))
})

test('oversized input is refused rather than clamped', () => {
  assert.throws(() => validateRecipe({ ...draft, title: 'x'.repeat(301) }), status(413))
  assert.throws(() => validateRecipe({ ...draft, ingredients: Array.from({ length: 201 }, () => bread) }), status(413))
  assert.throws(() => validateRecipe({ ...draft, steps: Array.from({ length: 101 }, () => 'Toast it.') }), status(413))
  assert.throws(() => validateRecipe({ ...draft, steps: ['x'.repeat(5001)] }), status(413))
})

test('well-formed and empty is not a recipe', () => {
  assert.throws(() => validateRecipe({ ...draft, ingredients: [], steps: [] }), status(422))
  assert.throws(() => validateRecipe({ ...draft, ingredients: [], steps: ['   '] }), status(422))
})

test('the source is checked variant by variant, not trusted', () => {
  const withSource = (source: unknown) => validateRecipe({ ...draft, source })
  assert.throws(() => withSource({ type: 'carrier pigeon' }), status(400))
  assert.throws(() => withSource(undefined), status(400))
  assert.throws(() => withSource({ type: 'website', url: 'not a url', retrievedAt: new Date().toISOString() }), status(400))
  assert.throws(() => withSource({ type: 'website', url: 'https://example.com/r', retrievedAt: 'whenever' }), status(400))

  const website = withSource({ type: 'website', url: 'https://example.com/r', retrievedAt: '2026-09-26T10:00:00.000Z', author: null, siteName: 'Example' })
  assert.deepEqual(website.source, { type: 'website', url: 'https://example.com/r', author: null, siteName: 'Example', retrievedAt: '2026-09-26T10:00:00.000Z' })

  // objectKey is storage's to assign, and there is no storage yet. A client
  // naming one is not believed.
  const photo = withSource({ type: 'photo', objectKey: 'someone-elses/photo.jpg', originalFilename: 'card.jpg' })
  assert.deepEqual(photo.source, { type: 'photo', objectKey: null, originalFilename: 'card.jpg' })
})

test('a missing source_lang becomes und rather than a guess', () => {
  const { draft: validated } = validateRecipe({ ...draft, source_lang: undefined })
  assert.equal(validated.source_lang, 'und')
})
