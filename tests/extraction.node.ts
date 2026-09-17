import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { createApp, defineEventHandler, readRawBody, toNodeListener, toWebHandler } from 'h3'
import { extractText, isUnit, normalizeRecipe, parseExtraction, parseQuantity, readExtractionText, validateText } from '../server/utils/textExtraction.ts'

const bread = { originalText: '1 slice bread', quantity: '1 slice', name: 'bread' }
const recipe = { title: 'Toast', source_lang: 'en', portions: 1, ingredients: [bread], steps: ['Toast the bread.'] }
const config = { ollamaBaseUrl: 'http://ollama:11434/', ollamaModel: 'test-model' }
const textSource = { type: 'text', originalText: 'source' } as const
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

test('text validation rejects missing, invalid and oversized input; preserves source', () => {
  for (const body of [null, [], {}, { text: 42 }, { text: '  ' }]) assert.throws(() => validateText(body), status(400))
  assert.throws(() => validateText({ text: 'x'.repeat(20_001) }), status(413))
  assert.equal(validateText({ text: ' Toast\n' }), ' Toast\n')
})

test('parsing preserves the source line and uses stable reference IDs', () => {
  const flour = { originalText: '1½ cups flour', quantity: '1½ cups', name: 'flour' }
  const result = parseExtraction({ ...recipe, title: null, portions: null, ingredients: [flour] }, textSource)
  assert.equal(result.title, null)
  assert.equal(result.ingredients[0].originalText, '1½ cups flour')
  assert.equal(result.ingredients[0].name, 'flour')
  assert.equal(result.ingredients[0].quantityText, '1½ cups')
  // Reading that text into numbers is normalizeRecipe's job, not this step's.
  assert.equal(result.ingredients[0].quantity, null)
  assert.equal(result.ingredients[0].id, 'ingredient_1')
  assert.deepEqual(result.steps[0].parts, [{ type: 'text', value: 'Toast the bread.' }])
  assert.deepEqual(result.source, { type: 'text', originalText: 'source' })
})

test('unusable envelopes fail; recoverable model slips are clamped', () => {
  // Reaching these means the grammar was not applied, so nothing can be trusted.
  for (const value of [null, [], {}, { ...recipe, ingredients: 'flour' }]) {
    assert.throws(() => parseExtraction(value, textSource), status(502))
  }
  assert.throws(() => parseExtraction({ ...recipe, ingredients: [], steps: [] }, textSource), status(422))
  assert.equal(parseExtraction({ ...recipe, portions: -1 }, textSource).portions, null)
  assert.equal(parseExtraction({ ...recipe, portions: Infinity }, textSource).portions, null)
  assert.equal(parseExtraction({ ...recipe, title: '  ' }, textSource).title, null)
  assert.equal(parseExtraction({ ...recipe, source_lang: '' }, textSource).source_lang, 'und')
  assert.deepEqual(parseExtraction({ ...recipe, steps: [42] }, textSource).steps, [])
  // Ingredients are objects now; a bare string is a slip, not a line.
  assert.deepEqual(parseExtraction({ ...recipe, ingredients: ['1 slice bread'] }, textSource).ingredients, [])
  // A model that segments nothing out still leaves a displayable line.
  const unsegmented = parseExtraction({ ...recipe, ingredients: [{ originalText: 'salt', quantity: '  ', name: '' }] }, textSource)
  assert.equal(unsegmented.ingredients[0].name, 'salt')
  assert.equal(unsegmented.ingredients[0].quantityText, null)
})

test('quantity parsing handles fractions, decimals, ranges and unknown units', () => {
  assert.deepEqual(parseQuantity('1½ cups'), { value: 1.5, maxValue: null, unit: 'cup' })
  assert.deepEqual(parseQuantity('1 1/2 cups'), { value: 1.5, maxValue: null, unit: 'cup' })
  assert.deepEqual(parseQuantity('1/2 tsp'), { value: 0.5, maxValue: null, unit: 'tsp' })
  assert.deepEqual(parseQuantity('½'), { value: 0.5, maxValue: null, unit: 'count' })
  assert.deepEqual(parseQuantity('2-3 tbsp'), { value: 2, maxValue: 3, unit: 'tbsp' })
  assert.deepEqual(parseQuantity('1,5 l'), { value: 1.5, maxValue: null, unit: 'l' })
  // Unknown wording keeps the number and reports no unit rather than guessing.
  assert.deepEqual(parseQuantity('1 slice'), { value: 1, maxValue: null, unit: null })
  assert.equal(parseQuantity('a pinch'), null)
  assert.equal(parseQuantity(null), null)
  // "c" is cups in an ingredient list and Celsius in an oven instruction.
  assert.equal(parseQuantity('1 c')!.unit, 'cup')
  assert.equal(parseQuantity('180 C')!.unit, 'celsius')
})

test('normalization fills ingredient quantities and locates measurements in steps', () => {
  const flour = { originalText: '1½ cups flour', quantity: '1½ cups', name: 'flour' }
  const result = normalizeRecipe(parseExtraction({
    ...recipe, ingredients: [flour], steps: ['Bake at 180C for 20 minutes.', 'Stir well.'],
  }, textSource))

  assert.deepEqual(result.ingredients[0].quantity, { value: 1.5, maxValue: null, unit: 'cup' })
  assert.equal(result.ingredients[0].originalText, '1½ cups flour')

  const [bake, stir] = result.steps
  assert.deepEqual(bake!.parts, [
    { type: 'text', value: 'Bake at ' },
    { type: 'measurement', quantity: 'temperature_1' },
    { type: 'text', value: ' for ' },
    { type: 'measurement', quantity: 'duration_1' },
    { type: 'text', value: '.' },
  ])
  assert.deepEqual(bake!.quantities.temperature_1, { value: 180, maxValue: null, unit: 'celsius', kind: 'temperature', scaleWithPortions: false })
  assert.deepEqual(bake!.quantities.duration_1, { value: 20, maxValue: null, unit: 'minute', kind: 'duration', scaleWithPortions: false })
  // Every reference resolves to a key created in the same step.
  for (const part of bake!.parts) {
    if (part.type === 'measurement') assert.ok(bake!.quantities[part.quantity])
  }
  // A step with no measurement keeps its single text part.
  assert.deepEqual(stir!.parts, [{ type: 'text', value: 'Stir well.' }])
  assert.deepEqual(stir!.quantities, {})
})

test('a step restating an ingredient amount references it instead of copying it', () => {
  const flour = { originalText: '2 cups flour', quantity: '2 cups', name: 'all-purpose flour' }
  const result = normalizeRecipe(parseExtraction({
    ...recipe,
    ingredients: [flour],
    steps: ['Add 2 cups flour and stir.', 'Bake at 180C.', 'Add 1 cup water.', 'Rest 20 to 25 minutes.'],
  }, textSource))
  const [add, bake, water, rest] = result.steps

  // The head noun matches, so "flour" finds "all-purpose flour".
  assert.deepEqual(add!.parts, [
    { type: 'text', value: 'Add ' },
    { type: 'ingredientQuantity', ingredientId: 'ingredient_1' },
    { type: 'text', value: ' flour and stir.' },
  ])
  // The amount lives on the ingredient now, not on the step.
  assert.deepEqual(add!.quantities, {})

  // An oven temperature restates no ingredient.
  assert.equal(bake!.parts[1]!.type, 'measurement')
  // A partial amount is not the ingredient's amount, so it stays a measurement.
  assert.equal(water!.parts[1]!.type, 'measurement')
  assert.deepEqual(rest!.quantities.duration_1, { value: 20, maxValue: 25, unit: 'minute', kind: 'duration', scaleWithPortions: false })

  // Nothing dangles: every reference resolves within the recipe.
  const ids = new Set(result.ingredients.map(ingredient => ingredient.id))
  for (const step of result.steps) {
    for (const part of step.parts) {
      if (part.type === 'ingredientQuantity') assert.ok(ids.has(part.ingredientId))
      if (part.type === 'measurement') assert.ok(step.quantities[part.quantity])
    }
  }
})

test('the shared unit vocabulary is exactly what parseQuantity can produce', () => {
  for (const unit of ['g', 'kg', 'oz', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'fl_oz', 'celsius', 'minute', 'cm', 'count']) {
    assert.equal(isUnit(unit), true, unit)
  }
  // The regional variants are resolved for display. One arriving from a parser
  // would never compare equal to the same amount read out of a step, so the
  // ingredient it belongs to would quietly stop rescaling with that step.
  for (const unit of ['cup_us', 'tbsp_metric', 'fl_oz_imperial', 'gallon', '', 42, null, undefined]) {
    assert.equal(isUnit(unit), false, String(unit))
  }
})

test('an amount a source parsed itself is validated, not trusted', () => {
  const quantityOf = (parsedQuantity: unknown) =>
    parseExtraction({ ...recipe, ingredients: [{ ...bread, parsedQuantity }] }, textSource).ingredients[0]!.quantity

  assert.deepEqual(quantityOf({ value: 1.5, maxValue: null, unit: 'cup' }), { value: 1.5, maxValue: null, unit: 'cup' })
  assert.deepEqual(quantityOf({ value: 2, maxValue: 3, unit: 'tbsp' }), { value: 2, maxValue: 3, unit: 'tbsp' })

  // Nothing usable in the envelope leaves the text to be read instead.
  for (const value of [null, undefined, 'cup', [], {}, { value: 0 }, { value: -1 }, { value: Infinity }, { value: '2' }]) {
    assert.equal(quantityOf(value), null, JSON.stringify(value) ?? 'undefined')
  }

  // A parser reports an upper limit equal to the value when the amount is not
  // a range; carrying that would stop it matching the same amount in a step.
  assert.deepEqual(quantityOf({ value: 2, maxValue: 2, unit: 'g' }), { value: 2, maxValue: null, unit: 'g' })
  // An unrecognised unit is reported as no unit, as parseQuantity does.
  for (const unit of ['cup_us', 'gallon', 42, null]) {
    assert.equal(quantityOf({ value: 1, unit })!.unit, null, String(unit))
  }
})

test('a parsed amount wins over the text and still links to the step restating it', () => {
  const milk = { originalText: '2 cups milk', quantity: '2 cups', name: 'milk', parsedQuantity: { value: 2, maxValue: null, unit: 'cup' } }
  const linked = normalizeRecipe(parseExtraction({ ...recipe, ingredients: [milk], steps: ['Pour in 2 cups milk.'] }, textSource))
  assert.deepEqual(linked.ingredients[0]!.quantity, { value: 2, maxValue: null, unit: 'cup' })
  assert.ok(linked.steps[0]!.parts.some(part => part.type === 'ingredientQuantity' && part.ingredientId === 'ingredient_1'))

  // Where the two readings disagree the source's wins, which is the point of
  // sending it: parseQuantity stops at the first number in "1 lb 2 oz".
  const composite = { originalText: '1 lb 2 oz potatoes', quantity: '1 lb 2 oz', name: 'potatoes', parsedQuantity: { value: 1.125, maxValue: null, unit: 'lb' } }
  const combined = normalizeRecipe(parseExtraction({ ...recipe, ingredients: [composite] }, textSource))
  assert.deepEqual(combined.ingredients[0]!.quantity, { value: 1.125, maxValue: null, unit: 'lb' })
  assert.deepEqual(parseQuantity('1 lb 2 oz'), { value: 1, maxValue: null, unit: null })

  // The text pipeline is untouched: no parsed amount means the text is read.
  const fromText = normalizeRecipe(parseExtraction({ ...recipe, ingredients: [{ originalText: '2 cups milk', quantity: '2 cups', name: 'milk' }] }, textSource))
  assert.deepEqual(fromText.ingredients[0]!.quantity, { value: 2, maxValue: null, unit: 'cup' })
})

test('Ollama request uses server config, structured output and separate source message', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'http://ollama:11434/api/chat')
    const body = JSON.parse(init!.body as string)
    assert.equal(body.model, 'test-model')
    assert.equal(body.stream, false)
    assert.equal(body.think, false)
    assert.equal(body.format.type, 'object')
    // Bounded string/array repetitions can prevent llama.cpp from compiling
    // the grammar at all. These limits belong in response validation.
    assert.doesNotMatch(JSON.stringify(body.format), /"(?:maxLength|minLength|maxItems|minItems)"/)
    assert.deepEqual(body.messages[1], { role: 'user', content: 'original source' })
    assert.ok(init?.signal)
    return Response.json({ done: true, message: { content: JSON.stringify(recipe) } })
  }
  const result = await extractText('original source', config, fetcher)
  assert.equal(result.recipe.title, 'Toast')
})

test('oversized fields are clamped to storage limits instead of failing', () => {
  const long = parseExtraction({
    ...recipe,
    title: 'x'.repeat(301),
    ingredients: [{ originalText: 'x'.repeat(2001), quantity: 'y'.repeat(101), name: 'z' }, ...Array(201).fill(bread)],
    steps: Array(101).fill('x'.repeat(5001)),
  }, textSource)
  assert.equal(long.title.length, 300)
  assert.equal(long.ingredients.length, 200)
  assert.equal(long.ingredients.at(-1).id, 'ingredient_200')
  assert.equal(long.ingredients[0].originalText.length, 2000)
  assert.equal(long.steps.length, 100)
  assert.equal(long.steps[0].originalText.length, 5000)
  assert.equal(long.ingredients[0].quantityText!.length, 100)
  const exact = parseExtraction({ ...recipe, ingredients: [{ ...bread, originalText: 'x'.repeat(2000) }], steps: ['x'.repeat(5000)] }, textSource)
  assert.equal(exact.ingredients[0].originalText.length, 2000)
  assert.equal(exact.steps[0].originalText.length, 5000)
})

test('upstream failures, malformed JSON and truncated answers become sanitized errors', async () => {
  const responses = [new Response('private upstream details', { status: 500 }), Response.json({ done: true, message: { content: '{' } }), Response.json({ done: true, done_reason: 'length', message: { content: JSON.stringify(recipe) } })]
  for (const response of responses) {
    await assert.rejects(extractText('source', config, async () => response), status(502))
  }
  await assert.rejects(extractText('source', config, async () => { throw new Error('secret host') }), status(502))
})

test('connection failures and upstream HTTP errors provide distinct diagnostics', async () => {
  await assert.rejects(extractText('source', config, async () => { throw new TypeError('fetch failed') }),
    error => status(502)(error) && /Could not connect to Ollama/.test((error as Error).message))
  await assert.rejects(extractText('source', config, async () => new Response('private upstream details', { status: 404 })),
    error => status(502)(error) && /Ollama returned HTTP 404/.test((error as Error).message) && !/private/.test((error as Error).message))
})

test('HTTP body reader enforces content type, JSON and length', async () => {
  const app = createApp().use(defineEventHandler(async event => ({ text: await readExtractionText(event) })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}`
  try {
    const post = (body: string, type = 'application/json') => fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body })
    assert.equal((await post('{}', 'text/plain')).status, 415)
    assert.equal((await post('{')).status, 400)
    assert.equal((await post(JSON.stringify({ text: 'a'.repeat(20_001) }))).status, 413)
    assert.deepEqual(await (await post(JSON.stringify({ text: 'Bread and butter' }))).json(), { text: 'Bread and butter' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('body reader handles requests passed through the H3 web adapter', async () => {
  const app = createApp().use(defineEventHandler(async event => ({ text: await readExtractionText(event) })))
  const response = await toWebHandler(app)(new Request('http://localhost/api/extract/text', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Toast the bread.' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { text: 'Toast the bread.' })
})

test('body reader reuses a native request body already read by middleware', async () => {
  const app = createApp().use(defineEventHandler(async event => {
    await readRawBody(event)
    return { text: await readExtractionText(event) }
  }))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Toast the bread.' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { text: 'Toast the bread.' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
