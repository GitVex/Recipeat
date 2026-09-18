import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createApp, defineEventHandler, readRawBody, toNodeListener, toWebHandler } from 'h3'
import { extractPhoto, extractText, extractWebsite, isUnit, normalizeRecipe, parseExtraction, parseQuantity, readExtractionPhoto, readExtractionText, unitInfo, validateText, validateUrl } from '../server/utils/extraction.ts'

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
  // A paste carries no picture, no timing, and nothing beside the name.
  assert.equal(result.image, null)
  assert.equal(result.totalTime, null)
  assert.equal(result.ingredients[0].extra, null)
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

test('the fetcher may only speak units this side already knows', () => {
  // The other half of the contract. units.json is a data file precisely so it
  // can be read from here: where the two vocabularies drift nothing throws,
  // a step's amount just stops matching the ingredient it restates.
  const map = JSON.parse(readFileSync(
    new URL('../services/recipeat-fetcher/src/recipeat_fetcher/units.json', import.meta.url), 'utf8',
  )) as Record<string, string>

  assert.ok(Object.keys(map).length > 0, 'the unit map is where this test expects it')
  for (const [pintName, unit] of Object.entries(map)) {
    assert.equal(isUnit(unit), true, `${pintName} -> ${unit}`)
    // Where this side knows the same word, both must read it the same way.
    const own = unitInfo(pintName)
    if (own) assert.equal(own[0], unit, pintName)
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
    // Property order is generation order under a grammar: the line is copied
    // verbatim before anything is taken out of it.
    assert.deepEqual(Object.keys(body.format.properties.ingredients.items.properties), ['originalText', 'quantity', 'name', 'extra'])
    assert.ok('totalTime' in body.format.properties)
    // Nothing only a page can supply. The model is not asked to invent one,
    // and a parsed amount is the fetcher's to send, never the model's.
    for (const absent of ['image', 'parsedQuantity', 'canonicalUrl', 'siteName']) {
      assert.doesNotMatch(JSON.stringify(body.format), new RegExp(absent), absent)
    }
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

const page = {
  title: 'Pancakes',
  language: 'en',
  yields: '4 servings',
  image: 'https://example.com/pancakes.jpg',
  totalTime: 45,
  canonicalUrl: 'https://example.com/pancakes',
  author: 'A Cook',
  siteName: 'Example Kitchen',
  // Already shaped like a draft's ingredient, with the amount the service read.
  ingredients: [{ originalText: '1 lb 2 oz potatoes', name: 'potatoes', quantity: '1 lb 2 oz', parsedQuantity: { value: 1.125, maxValue: null, unit: 'lb' }, extra: 'peeled' }],
  steps: ['Boil them.'],
}
const fetcherConfig = { fetcherBaseUrl: 'http://recipeat-fetcher:8000/' }
const served = (body: unknown, init?: ResponseInit): typeof fetch => async () => Response.json(body, init)
const sourceOf = (recipe: { source: unknown }) => recipe.source as { type: string, url: string, author: string | null, siteName: string | null, retrievedAt: string }

test('URL validation accepts web addresses and rejects everything else', () => {
  for (const body of [null, [], {}, { url: 42 }, { url: 'not a url' }, { url: 'ftp://example.com/r' }, { url: 'javascript:alert(1)' }, { url: 'file:///etc/passwd' }]) {
    assert.throws(() => validateUrl(body), status(400))
  }
  assert.throws(() => validateUrl({ url: `https://example.com/${'x'.repeat(2048)}` }), status(413))
  assert.equal(validateUrl({ url: '  https://Example.com/r  ' }), 'https://example.com/r')
})

test('website extraction sends the URL onward and records where the recipe came from', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'http://recipeat-fetcher:8000/fetch')
    assert.deepEqual(JSON.parse(init!.body as string), { url: 'https://example.com/pancakes' })
    assert.ok(init?.signal)
    return Response.json(page)
  }
  const { recipe: result } = await extractWebsite('https://example.com/pancakes', fetcherConfig, fetcher)
  assert.equal(result.title, 'Pancakes')
  assert.equal(result.source_lang, 'en')
  // "4 servings" is the site's wording; only the count is taken from it.
  assert.equal(result.portions, 4)
  // The amount the service read survives: parseQuantity stops at "1 lb" here.
  assert.deepEqual(normalizeRecipe(result).ingredients[0]!.quantity, { value: 1.125, maxValue: null, unit: 'lb' })
  assert.equal(result.image, 'https://example.com/pancakes.jpg')
  assert.equal(result.totalTime, 45)
  assert.equal(result.ingredients[0]!.extra, 'peeled')

  const source = sourceOf(result)
  assert.equal(source.type, 'website')
  assert.equal(source.url, 'https://example.com/pancakes')
  assert.equal(source.author, 'A Cook')
  assert.equal(source.siteName, 'Example Kitchen')
  assert.ok(Date.parse(source.retrievedAt))
})

test('page metadata is clamped, and its URLs checked like anything else a page says', async () => {
  const extracted = async (fields: Record<string, unknown>) =>
    (await extractWebsite('https://example.com/r', fetcherConfig, served({ ...page, ...fields }))).recipe

  // An image is rendered into a page a user looks at, so it is a link like the
  // canonical one and gets the same treatment.
  for (const image of ['javascript:alert(1)', 'data:text/html;base64,x', '/relative.jpg', 42, null]) {
    assert.equal((await extracted({ image })).image, null, String(image))
  }
  assert.equal((await extracted({ image: 'http://example.com/a.jpg' })).image, 'http://example.com/a.jpg')

  // Minutes, rounded and capped. Anything that is not a duration is dropped.
  for (const totalTime of [0, -5, Infinity, '45', null]) {
    assert.equal((await extracted({ totalTime })).totalTime, null, String(totalTime))
  }
  assert.equal((await extracted({ totalTime: 44.6 })).totalTime, 45)
  assert.equal((await extracted({ totalTime: 1e9 })).totalTime, 60 * 24 * 30)

  // Whoever the page credits and whatever it calls itself are its own wording.
  const credited = await extracted({ author: '   ', siteName: 'x'.repeat(400) })
  assert.equal(sourceOf(credited).author, null)
  assert.equal(sourceOf(credited).siteName!.length, 300)

  const wordy = await extracted({ ingredients: [{ ...page.ingredients[0], extra: 'x'.repeat(600) }] })
  assert.equal(wordy.ingredients[0]!.extra!.length, 500)
})

test("a page's own canonical link is checked before it is believed", async () => {
  // It is stored, and later rendered as a link, so it is as untrusted as any
  // other string the page chose.
  for (const canonicalUrl of ['javascript:alert(1)', 'file:///etc/passwd', 42, null, undefined]) {
    const { recipe: result } = await extractWebsite('https://example.com/r', fetcherConfig, served({ ...page, canonicalUrl }))
    assert.equal(sourceOf(result).url, 'https://example.com/r', String(canonicalUrl))
  }
  const { recipe: moved } = await extractWebsite('https://example.com/r', fetcherConfig, served({ ...page, canonicalUrl: 'https://example.com/canonical' }))
  assert.equal(sourceOf(moved).url, 'https://example.com/canonical')
})

test('fetcher failures become the status the caller should see', async () => {
  const extract = (fetcher: typeof fetch) => extractWebsite('https://example.com/r', fetcherConfig, fetcher)

  // A detail from the fetcher is a message we wrote about the caller's own
  // URL, so it is passed on rather than replaced with something vaguer.
  await assert.rejects(extract(served({ detail: 'No recipe scraper supports example.com.' }, { status: 422 })),
    error => status(422)(error) && /No recipe scraper supports/.test((error as Error).message))
  await assert.rejects(extract(served({ detail: 'That page is too large to read.' }, { status: 413 })), status(413))
  await assert.rejects(extract(served({ detail: 'example.com answered 404.' }, { status: 502 })),
    error => status(502)(error) && /answered 404/.test((error as Error).message))
  await assert.rejects(extract(served({ detail: 'slow.example did not answer in time.' }, { status: 504 })), status(504))
  // A URL that serves something other than a page is the caller's problem, but
  // not a problem with the content type of the request they made.
  await assert.rejects(extract(served({ detail: 'x served application/pdf, not a web page.' }, { status: 415 })),
    error => status(422)(error) && /not a web page/.test((error as Error).message))

  // Anything that is not one of those messages gets our own wording.
  await assert.rejects(extract(served({ detail: [{ loc: ['body'] }] }, { status: 422 })),
    error => status(422)(error) && /That page could not be read/.test((error as Error).message))
  await assert.rejects(extract(async () => { throw new TypeError('fetch failed') }),
    error => status(502)(error) && /Could not connect to the recipe fetcher/.test((error as Error).message))
  await assert.rejects(extract(async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }) }), status(504))
  await assert.rejects(extract(async () => new Response('<html>', { status: 200 })), status(502))

  // An empty page is not an extraction failure, and says so in its own terms.
  await assert.rejects(extract(served({ ...page, ingredients: [], steps: [] })),
    error => status(422)(error) && /on that page/.test((error as Error).message))
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

const ocrConfig = { ...config, ocrBaseUrl: 'http://recipeat-ocr:8001/' }
const photo = { data: new Uint8Array([1, 2, 3]), filename: 'page.jpg', type: 'image/jpeg' }
const reading = { text: '1 slice bread\n\nToast the bread.', lines: [{ text: '1 slice bread', confidence: 0.9 }], elapsed: 0.9 }
// The model answers the OCR text, not the image.
const modelled = (draft: unknown): typeof fetch => async (url) =>
  String(url).includes('/ocr') ? Response.json(reading) : Response.json({ message: { content: JSON.stringify(draft) } })

test('photo extraction reads the image, then the text, and records the filename', async () => {
  const seen: { url: string, body: unknown }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    seen.push({ url: String(url), body: init!.body })
    if (String(url).includes('/ocr')) return Response.json(reading)
    return Response.json({ message: { content: JSON.stringify(recipe) } })
  }

  const { recipe: result, text } = await extractPhoto(photo, ocrConfig, fetcher)

  assert.equal(seen[0]!.url, 'http://recipeat-ocr:8001/ocr')
  // The image goes to OCR as a multipart upload, and never to Ollama at all.
  assert.ok(seen[0]!.body instanceof FormData)
  const sent = (seen[0]!.body as FormData).get('file') as File
  assert.equal(sent.name, 'page.jpg')
  assert.equal(sent.type, 'image/jpeg')
  assert.equal(sent.size, 3)

  assert.equal(seen[1]!.url, 'http://ollama:11434/api/chat')
  const messages = JSON.parse(seen[1]!.body as string).messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1].content, reading.text)
  assert.ok(!('images' in messages[1]), 'the photo is not sent to the model')
  assert.match(messages[0].content, /read from a photograph by OCR/)

  assert.equal(text, reading.text)
  assert.equal(result.title, 'Toast')
  assert.deepEqual(result.source, { type: 'photo', objectKey: null, originalFilename: 'page.jpg' })
})

test('a photo without a usable filename still extracts', async () => {
  const { recipe: result } = await extractPhoto({ ...photo, filename: null, type: null }, ocrConfig, modelled(recipe))
  assert.deepEqual(result.source, { type: 'photo', objectKey: null, originalFilename: null })
})

test('OCR failures become the status the caller should see', async () => {
  const extract = (fetcher: typeof fetch) => extractPhoto(photo, ocrConfig, fetcher)

  // A detail from the OCR service is a message we wrote about the caller's own
  // upload, so it is passed on rather than replaced with something vaguer.
  await assert.rejects(extract(served({ detail: 'No text could be read from that image.' }, { status: 422 })),
    error => status(422)(error) && /No text could be read/.test((error as Error).message))
  // Unlike the website path, 415 keeps its meaning: the body really is the photo.
  await assert.rejects(extract(served({ detail: 'That file is not an image this service can read.' }, { status: 415 })),
    error => status(415)(error) && /not an image/.test((error as Error).message))
  await assert.rejects(extract(served({ detail: 'That image is too large to read.' }, { status: 413 })), status(413))
  await assert.rejects(extract(async () => { throw new TypeError('fetch failed') }),
    error => status(502)(error) && /Could not connect to the OCR service/.test((error as Error).message))
  await assert.rejects(extract(async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }) }), status(504))
  await assert.rejects(extract(async () => new Response('not json', { status: 200 })), status(502))
  // A reading with no text in it is the service's problem, not the caller's.
  await assert.rejects(extract(served({ ...reading, text: '   ' })), status(502))
  // The model's own ceiling, reached by a photo of a stack of pages.
  await assert.rejects(extract(served({ ...reading, text: 'x'.repeat(20_001) })), status(413))
  // An unreadable photo is not an extraction failure, and says so in its terms.
  await assert.rejects(extract(modelled({ ...recipe, ingredients: [], steps: [] })),
    error => status(422)(error) && /in that photo/.test((error as Error).message))
})

test('photo upload reader enforces content type, the file part and its size', async () => {
  const app = createApp().use(defineEventHandler(async event => {
    const { data, filename, type } = await readExtractionPhoto(event)
    return { bytes: data.length, filename, type }
  }))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const send = (body: BodyInit, headers?: HeadersInit) => fetch(url, { method: 'POST', body, headers })
    const form = (file: Blob, name = 'file', filename = 'page.jpg') => {
      const data = new FormData()
      data.append(name, file, filename)
      return data
    }
    const jpeg = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })

    assert.equal((await send('{}', { 'Content-Type': 'application/json' })).status, 415)
    assert.equal((await send(form(jpeg(8), 'photo'))).status, 400)
    assert.equal((await send(form(jpeg(0)))).status, 400)
    assert.equal((await send(form(jpeg(10_000_001)))).status, 413)

    // A directory component in the name is dropped; the rest is kept as a label.
    const response = await send(form(jpeg(8), 'file', '../../etc/passwd.jpg'))
    assert.deepEqual(await response.json(), { bytes: 8, filename: 'passwd.jpg', type: 'image/jpeg' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
