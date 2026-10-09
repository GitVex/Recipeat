import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { bodyOf, editOf } from '../../shared/utils/recipeDraft.ts'
import type { ExtractedRecipe } from '../../shared/types/recipe.ts'

const issuer = 'http://localhost:3101'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
const codes = new Map<string, URLSearchParams>()
let failure = ''
let lastAuthorization: URLSearchParams
let lastLogout: URLSearchParams
let refreshCount = 0
let server: Server

function idToken(nonce: string | null) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: failure === 'issuer' ? 'https://wrong.example' : issuer,
    aud: failure === 'audience' ? 'another-app' : 'recipeat-test',
    sub: 'test-user', iat: now, exp: failure === 'expired' ? now - 60 : now + 3600,
    ...(nonce && { nonce: failure === 'nonce' ? 'wrong-nonce' : nonce }),
  })).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), failure === 'signature' ? wrongKey : privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url!, issuer)
    const json = (data: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)) }
    if (url.pathname === '/.well-known/openid-configuration') return json({
      issuer, jwks_uri: `${issuer}/jwks`, authorization_endpoint: `${issuer}/oauth/v2/authorize`,
      token_endpoint: `${issuer}/oauth/v2/token`, userinfo_endpoint: `${issuer}/oidc/v1/userinfo`,
      end_session_endpoint: `${issuer}/oidc/v1/end_session`, id_token_signing_alg_values_supported: ['RS256'],
    })
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/oauth/v2/authorize') {
      lastAuthorization = url.searchParams
      const code = randomUUID()
      codes.set(code, url.searchParams)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', failure === 'state' ? 'wrong-state' : url.searchParams.get('state')!)
      response.writeHead(302, { Location: callback.toString() }); return response.end()
    }
    if (url.pathname === '/oauth/v2/token') {
      let body = ''
      for await (const chunk of request) body += chunk
      const params = new URLSearchParams(body)
      let nonce: string | null = null
      if (params.get('grant_type') === 'refresh_token') {
        if (params.get('refresh_token') !== 'test-refresh-token') { response.statusCode = 400; return json({ error: 'invalid_grant' }) }
        refreshCount++
      } else {
        const authorization = codes.get(params.get('code')!)
        codes.delete(params.get('code')!)
        const challenge = createHash('sha256').update(params.get('code_verifier') || '').digest('base64url')
        if (!authorization || challenge !== authorization.get('code_challenge') || params.get('client_id') !== 'recipeat-test') {
          response.statusCode = 400; return json({ error: 'invalid_grant' })
        }
        nonce = authorization.get('nonce')
      }
      return json({ access_token: 'opaque-access-token', refresh_token: 'test-refresh-token', token_type: 'Bearer', expires_in: params.get('grant_type') === 'refresh_token' ? 3600 : 65, id_token: idToken(nonce) })
    }
    if (url.pathname === '/oidc/v1/userinfo') return json({ sub: 'test-user', name: 'Test Cook', email: 'cook@example.test', private_claim: 'must-be-filtered' })
    if (url.pathname === '/oidc/v1/end_session') {
      lastLogout = url.searchParams
      response.writeHead(302, { Location: url.searchParams.get('post_logout_redirect_uri')! }); return response.end()
    }
    response.statusCode = 404; response.end()
  })
  await new Promise<void>(resolve => server.listen(3101, resolve))
})
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
test.beforeEach(() => { failure = '' })

test('text extraction requires login and validates authenticated requests', async ({ page }) => {
  const anonymous = await page.request.post('/api/extract/text', { data: { text: 'Toast' } })
  expect(anonymous.status()).toBe(401)
  expect(anonymous.headers()['cache-control']).toBe('no-store')
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
  expect((await page.request.post('/api/extract/text', { data: { text: '' } })).status()).toBe(400)
})

test('login, PKCE, session persistence, token refresh, and logout', async ({ page }) => {
  expect((await page.request.get('/api/me')).status()).toBe(401)
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
  expect(lastAuthorization.get('code_challenge_method')).toBe('S256')
  expect(lastAuthorization.get('nonce')).toBeTruthy()
  expect(lastAuthorization.get('state')).toBeTruthy()
  const me = await page.request.get('/api/me')
  expect(await me.json()).toEqual({ provider: 'zitadel', subject: 'test-user', profile: { sub: 'test-user', name: 'Test Cook', email: 'cook@example.test' } })
  const session = await (await page.request.get('/api/_auth/session')).json()
  expect(session.accessToken).toBeUndefined()
  expect(session.idToken).toBeUndefined()
  expect((await page.context().cookies()).find(c => c.name === 'nuxt-oidc-auth')?.httpOnly).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  const beforeRefresh = refreshCount
  await expect.poll(async () => {
    expect((await page.request.get('/api/me')).ok()).toBe(true)
    return refreshCount
  }, { timeout: 12000, intervals: [1000] }).toBeGreaterThan(beforeRefresh)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  expect(lastLogout.get('id_token_hint')).toBeTruthy()
  expect(lastLogout.get('client_id')).toBe('recipeat-test')
  expect((await page.request.get('/api/me')).status()).toBe(401)
})

for (const invalid of ['state', 'signature', 'issuer', 'audience', 'nonce', 'expired']) {
  test(`rejects invalid ${invalid}`, async ({ page }) => {
    failure = invalid
    await page.goto('/auth/zitadel/login')
    expect((await page.request.get('/api/me')).status()).toBe(401)
  })
}

// The storage path end to end: a session, a row, and the subject the row is
// attributed to. Needs a database, and says so rather than failing without
// one — docs/database.md has the container.
test('a signed-in user saves a recipe, reads it back, and owns it by subject', async ({ page }) => {
  test.skip(!process.env.NUXT_DATABASE_URL, 'NUXT_DATABASE_URL is not set')
  const title = `Playwright toast ${randomUUID()}`
  const recipe = {
    title,
    source_lang: 'en',
    portions: 2,
    ingredients: [{ originalText: '200 g flour', quantity: '200 g', name: 'flour' }],
    steps: ['Mix the 200 g flour in.'],
    source: { type: 'text', originalText: 'a paste' },
  }

  expect((await page.request.post('/api/recipes', { data: { recipe } })).status()).toBe(401)
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()

  const created = await page.request.post('/api/recipes', { data: { recipe } })
  expect(created.status()).toBe(201)
  expect(created.headers()['cache-control']).toBe('no-store')
  const saved = (await created.json()).recipe
  // Stored as the first version of its own line, and the entry point for it.
  expect(saved.lineId).toBe(saved.id)
  expect(saved.pinned).toBe(true)
  // Rebuilt server-side rather than echoed: the step knows which ingredient
  // its amount restates.
  expect(saved.steps[0].parts.some((part: { type: string }) => part.type === 'ingredientQuantity')).toBe(true)

  const listed = (await (await page.request.get('/api/recipes')).json()).recipes
  expect(listed.map((row: { id: string }) => row.id)).toContain(saved.id)
  expect((await (await page.request.get(`/api/recipes/${saved.id}`)).json()).recipe).toEqual(saved)

  expect((await page.request.get('/api/recipes/not-a-uuid')).status()).toBe(400)
  expect((await page.request.get(`/api/recipes/${randomUUID()}`)).status()).toBe(404)
  expect((await page.request.post('/api/recipes', { data: { recipe: { ...recipe, ingredients: [], steps: [] } } })).status()).toBe(422)
  expect((await page.request.post('/api/recipes', { data: { recipe: { ...recipe, portions: -1 } } })).status()).toBe(400)

  // The acceptance criterion this test exists for: the row is attributed to
  // the subject in the session, which no request body mentioned.
  const sql = postgres(process.env.NUXT_DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const rows = await sql<{ owner_sub: string }[]>`SELECT owner_sub FROM recipes WHERE id = ${saved.id}`
    expect(rows[0]?.owner_sub).toBe('test-user')
  } finally {
    await sql`DELETE FROM recipes WHERE owner_sub = 'test-user'`
    await sql.end()
  }
})

// The three write actions over HTTP, with the session doing the owning.
test('save, save as progression and save as variant, each through its own route', async ({ page }) => {
  test.skip(!process.env.NUXT_DATABASE_URL, 'NUXT_DATABASE_URL is not set')
  const mark = randomUUID()
  const recipe = (title: string) => ({
    title: `${title} ${mark}`,
    source_lang: 'en',
    portions: 2,
    ingredients: [{ originalText: '200 g flour', quantity: '200 g', name: 'flour' }],
    steps: ['Mix the 200 g flour in.'],
    source: { type: 'text', originalText: 'a paste' },
  })
  const post = async (path: string, title: string) => {
    const response = await page.request.post(path, { data: { recipe: recipe(title) } })
    return { status: response.status(), recipe: response.ok() ? (await response.json()).recipe : null }
  }

  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()

  const created = await post('/api/recipes', 'Stew')
  expect(created.status).toBe(201)
  const root = created.recipe

  // Save: same row, same place in the line.
  const saved = await page.request.put(`/api/recipes/${root.id}`, { data: { recipe: recipe('Stew, salted') } })
  expect(saved.status()).toBe(200)
  const corrected = (await saved.json()).recipe
  expect(corrected.id).toBe(root.id)
  expect([corrected.lineId, corrected.progressionOf, corrected.variantOf]).toEqual([root.lineId, null, null])

  // Progression: same line, and it takes the pin.
  const progression = await post(`/api/recipes/${root.id}/progressions`, 'Stew, browned first')
  expect(progression.status).toBe(201)
  expect(progression.recipe.lineId).toBe(root.lineId)
  expect(progression.recipe.progressionOf).toBe(root.id)
  expect(progression.recipe.pinned).toBe(true)
  expect((await (await page.request.get(`/api/recipes/${root.id}`)).json()).recipe.pinned).toBe(false)

  // Variant: a line of its own, and the line it left keeps its own pin.
  const variant = await post(`/api/recipes/${progression.recipe.id}/variants`, 'Stew, vegetarian')
  expect(variant.status).toBe(201)
  expect(variant.recipe.lineId).toBe(variant.recipe.id)
  expect(variant.recipe.variantOf).toBe(progression.recipe.id)

  // A listing is one entry per line: the progression, and the variant beside it.
  const listed = (await (await page.request.get('/api/recipes')).json()).recipes.filter((row: { title: string }) => row.title.endsWith(mark))
  expect(listed.map((row: { id: string }) => row.id).sort()).toEqual([progression.recipe.id, variant.recipe.id].sort())

  // A version that is not there, and an id that is not one.
  expect((await page.request.put(`/api/recipes/${randomUUID()}`, { data: { recipe: recipe('Nowhere') } })).status()).toBe(404)
  expect((await post(`/api/recipes/${randomUUID()}/progressions`, 'Nowhere')).status).toBe(404)
  expect((await post(`/api/recipes/${randomUUID()}/variants`, 'Nowhere')).status).toBe(404)
  expect((await post('/api/recipes/not-a-uuid/progressions', 'Nowhere')).status).toBe(400)
  // The body is checked on every one of them, not just the first.
  expect((await page.request.put(`/api/recipes/${root.id}`, { data: { recipe: { ...recipe('Empty'), ingredients: [], steps: [] } } })).status()).toBe(422)

  const sql = postgres(process.env.NUXT_DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const owners = await sql<{ owner_sub: string }[]>`SELECT DISTINCT owner_sub FROM recipes WHERE title LIKE ${'%' + mark}`
    expect(owners.map(row => row.owner_sub)).toEqual(['test-user'])
  } finally {
    await sql`DELETE FROM recipes WHERE owner_sub = 'test-user'`
    await sql.end()
  }
})

// The import dialog against the real session, with the extraction routes
// stubbed: what is under test is what the dialog sends and what it makes of
// each answer, not the model.
const extracted = {
  title: 'Playwright pancakes',
  source_lang: 'en',
  portions: 2,
  image: null,
  totalTime: null,
  ingredients: [{ id: 'ingredient_1', originalText: '200 g flour', name: 'flour', quantityText: '200 g', quantity: { value: 200, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Whisk it all together.', parts: [{ type: 'text', value: 'Whisk it all together.' }], quantities: {} }],
  source: { type: 'text', originalText: 'pancakes' },
}
const answer = (status: number) => status === 200
  ? { status, json: { recipe: extracted } }
  : { status, json: { statusCode: status, message: 'upstream detail a person should never see' } }

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
}

test('signed out, importing asks for a sign-in and comes back to the dialog', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByRole('button', { name: 'Sign in to continue' }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Website' })).toBeVisible()
})

test('an extraction opens the recipe it returned, after a busy answer is retried', async ({ page }) => {
  const bodies: unknown[] = []
  await page.route('**/api/extract/website', route => {
    bodies.push(route.request().postDataJSON())
    return route.fulfill(answer(bodies.length === 1 ? 503 : 200))
  })
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByLabel('Recipe URL').fill('https://example.com/pancakes')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Recipeat is busy right now')
  await expect(alert).not.toHaveClass(/\berror\b/)
  await expect(page.getByText('upstream detail')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('dialog')).toContainText('Playwright pancakes')
  await expect(page.getByRole('dialog')).toContainText('200 g flour')
  expect(bodies).toEqual([{ url: 'https://example.com/pancakes' }, { url: 'https://example.com/pancakes' }])
})

// A prefix link (#136): filled in on the Website tab and left there, since any
// page can make a browser load it. Only the person's click sends it.
test('a prefix link fills in the import and sends nothing until asked', async ({ page }) => {
  const bodies: unknown[] = []
  await page.route('**/api/extract/website', route => { bodies.push(route.request().postDataJSON()); return route.fulfill(answer(200)) })
  await signIn(page)
  const url = 'https://example.com/pancakes?serves=4'
  await page.goto(`/get/${url}`)
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(page.getByRole('tab', { name: 'Website' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Recipe URL')).toHaveValue(url)
  await page.waitForTimeout(500)
  expect(bodies).toEqual([])
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('dialog')).toContainText('Playwright pancakes')
  expect(bodies).toEqual([{ url }])
})

test('signed out, a prefix link comes back from the sign-in with its address', async ({ page }) => {
  await page.goto('/get/https://example.com/pancakes')
  await page.getByRole('button', { name: 'Sign in to continue' }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Recipe URL')).toHaveValue('https://example.com/pancakes')
})

test('one request at a time, and closing or switching tabs drops it for good', async ({ page }) => {
  let calls = 0
  const held: (() => Promise<void>)[] = []
  await page.route('**/api/extract/text', route => {
    calls++
    // Answered only when the test says so, and quietly if the page has
    // already given up on it.
    held.push(() => route.fulfill(answer(200)).catch(() => {}))
  })
  await signIn(page)
  const trigger = page.getByRole('button', { name: 'Save your first recipe' })
  await trigger.click()
  await page.getByRole('tab', { name: 'Text', exact: true }).click()
  await page.getByLabel('Recipe text').fill('Flour, milk, eggs. Mix and fry.')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('button', { name: 'Reading…' })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('several seconds')
  // Past the disabled button: a second submit while the first is out.
  await page.locator('.import-modal form').evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect.poll(() => calls).toBe(1)

  await page.getByRole('button', { name: 'Close import' }).click()
  await Promise.all(held.splice(0).map(release => release()))
  await page.waitForTimeout(300)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await trigger.click()
  await expect(page.getByLabel('Recipe text')).toHaveValue('Flour, milk, eggs. Mix and fry.')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect.poll(() => calls).toBe(2)
  await page.getByRole('tab', { name: 'Photo', exact: true }).click()
  await Promise.all(held.splice(0).map(release => release()))
  await page.waitForTimeout(300)
  await expect(page.getByRole('dialog')).not.toContainText('Playwright pancakes')
  await expect(page.getByRole('button', { name: 'Bring it in' })).toBeEnabled()
})

test('a lapsed session keeps what was typed through the sign-in', async ({ page }) => {
  await page.route('**/api/extract/text', route => route.fulfill(answer(401)))
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByRole('tab', { name: 'Text', exact: true }).click()
  await page.getByLabel('Recipe text').fill('Two eggs, beaten. Fry them in butter.')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('signed out')
  await page.getByRole('button', { name: 'Sign in again' }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Text', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Recipe text')).toHaveValue('Two eggs, beaten. Fry them in butter.')
})

test('a photo goes up as multipart, and a photo with no recipe says so', async ({ page }) => {
  let contentType = ''
  let body = ''
  await page.route('**/api/extract/photo', route => {
    contentType = route.request().headers()['content-type'] ?? ''
    body = route.request().postDataBuffer()?.toString('latin1') ?? ''
    return route.fulfill(answer(422))
  })
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByRole('tab', { name: 'Photo', exact: true }).click()
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('Choose a photo')
  await page.locator('input[type=file]').setInputFiles({ name: 'recipe.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t find a recipe in that photo')
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
  // Sent as the 1600 px JPEG copy (#40), under the name it was chosen by.
  expect(body).toContain('name="file"; filename="recipe.png"')
  expect(body).toContain('Content-Type: image/jpeg')
})

// The long edge of a JPEG, from its first frame header.
function longEdge(jpeg: Buffer) {
  for (let i = 2; i < jpeg.length;) {
    if (jpeg[i] !== 0xff) { i++; continue }
    const marker = jpeg[i + 1]!
    if (marker >= 0xc0 && marker <= 0xc3) return Math.max(jpeg.readUInt16BE(i + 5), jpeg.readUInt16BE(i + 7))
    i += 2 + jpeg.readUInt16BE(i + 2)
  }
  return 0
}

test('a photo is sent to the model as its 1600 px copy, and one the browser cannot draw is refused unsent', async ({ page }) => {
  const sent: Buffer[] = []
  await page.route('**/api/extract/photo', route => {
    sent.push(route.request().postDataBuffer() ?? Buffer.alloc(0))
    return route.fulfill(answer(422))
  })
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByRole('tab', { name: 'Photo', exact: true }).click()

  // A cookbook page as a phone sends it, 2048 px on its long edge.
  const original = readFileSync('tests/imges/IMG_5273.JPEG')
  await page.locator('input[type=file]').setInputFiles({ name: 'page.jpg', mimeType: 'image/jpeg', buffer: original })
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t find a recipe in that photo')
  expect(sent).toHaveLength(1)
  const start = sent[0]!.indexOf(Buffer.from([0xff, 0xd8, 0xff]))
  const jpeg = sent[0]!.subarray(start)
  expect(longEdge(jpeg)).toBe(1600)
  expect(jpeg.length).toBeLessThan(original.length)

  // Over the server's 10 MB cap as chosen, well under it as sent: a phone's
  // full 4032 px, filled with noise so no encoder can shrink it.
  const huge = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4032
    canvas.height = 3024
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(canvas.width, canvas.height)
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.random() * 256
    context.putImageData(pixels, 0, 0)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', 1))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  }), 'base64')
  expect(huge.length).toBeGreaterThan(10_000_000)
  await page.locator('input[type=file]').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: huge })
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect.poll(() => sent.length).toBe(2)
  expect(sent[1]!.length).toBeLessThan(1_600_000)

  // What desktop Chrome makes of a HEIC: bytes it cannot decode.
  await page.locator('input[type=file]').setInputFiles({ name: 'page.heic', mimeType: 'image/heic', buffer: Buffer.from('not a picture this browser can draw') })
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('can’t read that picture')
  expect(sent).toHaveLength(2)
})

// Which way a link will be read (#60): a hint from the fetcher's site list,
// with no request made for the link itself until it is sent.
test('a link says whether its site is supported, and an unlisted page with no recipe says so in the same words', async ({ page }) => {
  let sites = 0
  const extracted: string[] = []
  await page.route('**/api/extract/sites', route => { sites++; return route.fulfill({ json: { hosts: ['bbcgoodfood.com', 'cooking.nytimes.com'] } }) })
  await page.route('**/api/extract/website', route => { extracted.push(route.request().url()); return route.fulfill(answer(422)) })
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  const field = page.getByLabel('Recipe URL')
  const hint = page.locator('#site-hint')
  await expect(hint).toHaveText('See which sites are supported')
  await expect(hint.getByRole('link')).toHaveAttribute('href', '/sites')
  // An empty field also points to the shortcuts (#136); typing hides it.
  const shortcut = page.locator('.import-shortcut')
  await expect(shortcut).toContainText('http://localhost:3100/get/')
  await expect(shortcut.getByRole('link', { name: 'bookmarklet on your profile' })).toHaveAttribute('href', '/profile#send')
  await page.screenshot({ path: 'test-results/import-shortcut.png' })

  await field.fill('https://www.bbcgoodfood.com/recipes/pancakes')
  await expect(hint).toContainText('Supported')
  await expect(shortcut).toHaveCount(0)
  await field.fill('https://nytimes.com/recipes/1')
  await expect(hint).toContainText('Not on the supported list, so we’ll try reading the page’s recipe markup.')
  // Not a URL the dialog would send, so it is not a site either.
  await field.fill('bbcgoodfood.com/recipes/pancakes')
  await expect(hint).toHaveText('See which sites are supported')
  expect(extracted).toEqual([])

  await field.fill('https://example.com/about')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toHaveText('That site isn’t on the supported list, and the page has no recipe markup we could read.')
  // Neither the hint nor the answer blocked the request.
  expect(extracted).toHaveLength(1)
  expect(sites).toBe(1)
})

test('a supported page with no recipe keeps the plain answer', async ({ page }) => {
  await page.route('**/api/extract/sites', route => route.fulfill({ json: { hosts: ['bbcgoodfood.com'] } }))
  await page.route('**/api/extract/website', route => route.fulfill(answer(422)))
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByLabel('Recipe URL').fill('https://www.bbcgoodfood.com/')
  await expect(page.locator('#site-hint')).toContainText('Supported')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t find a recipe on that page.')
})

test('an Instagram post link is a website import, with its own hint and wording', async ({ page }) => {
  const sent: unknown[] = []
  await page.route('**/api/extract/sites', route => route.fulfill({ status: 502, json: { statusCode: 502 } }))
  await page.route('**/api/extract/website', route => {
    sent.push(route.request().postDataJSON())
    return route.fulfill(answer(sent.length === 1 ? 422 : 200))
  })
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  const field = page.getByLabel('Recipe URL')
  const hint = page.locator('#site-hint')

  // A profile is not a post, so it gets no Instagram hint and no list either.
  await field.fill('https://www.instagram.com/noor.baqtiar/')
  await expect(hint).toHaveText('See which sites are supported')
  await field.fill('https://www.instagram.com/p/DbXWEUaxWVd/?igsh=abc')
  // Recognised, and asked for the recipe's own link first (#121).
  await expect(hint).toContainText('Instagram post recognised')
  await expect(hint).toContainText('paste that link instead')

  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t find a recipe in that post.')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('dialog')).toContainText(extracted.title!)
  // The website route, both times (#120).
  expect(sent).toEqual([
    { url: 'https://www.instagram.com/p/DbXWEUaxWVd/?igsh=abc' },
    { url: 'https://www.instagram.com/p/DbXWEUaxWVd/?igsh=abc' },
  ])
})
test('without the site list there is no hint, and importing still works', async ({ page }) => {
  await page.route('**/api/extract/sites', route => route.fulfill({ status: 502, json: { statusCode: 502 } }))
  await page.route('**/api/extract/website', route => route.fulfill(answer(200)))
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByLabel('Recipe URL').fill('https://example.com/pancakes')
  await expect(page.locator('#site-hint')).toHaveText('See which sites are supported')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('dialog')).toContainText('Playwright pancakes')
})

// Adding an import to the collection (#41). The extraction is stubbed as
// above; so is the save, except in the last test, which writes a real row.
const storedFrom = (recipe: object) => ({
  ...recipe,
  id: randomUUID(), lineId: randomUUID(), progressionOf: null, variantOf: null, pinned: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
})

async function importText(page: import('@playwright/test').Page) {
  await page.route('**/api/extract/text', route => route.fulfill(answer(200)))
  await signIn(page)
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByRole('tab', { name: 'Text', exact: true }).click()
  await page.getByLabel('Recipe text').fill('Pancakes: 200 g flour. Whisk it all together.')
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('heading', { name: 'Playwright pancakes' })).toBeVisible()
}

test('an import is added once, as it reads in the dialog, and becomes the stored recipe', async ({ page }) => {
  const posted: unknown[] = []
  let release = () => {}
  await page.route('**/api/recipes', async route => {
    posted.push(route.request().postDataJSON())
    await new Promise<void>(resolve => (release = resolve))
    // What the server makes of an unedited import is the import, stored.
    await route.fulfill({ status: 201, json: { recipe: storedFrom(extracted) } })
  })
  await importText(page)
  await expect(page.getByRole('button', { name: 'Save to my collection' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add to my recipes' }).click()
  await expect(page.getByRole('button', { name: 'Adding…' })).toBeDisabled()
  // The handler has to be holding the request before there is anything to let go.
  await expect.poll(() => posted.length).toBe(1)
  release()
  await expect(page.getByText('In your recipes')).toBeFocused()
  await expect(page.getByRole('button', { name: /Add to my recipes|Adding/ })).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('added to your recipes')
  // Unedited, it goes as the editor sends any recipe: every line as it was
  // extracted, in the shape a save takes.
  expect(posted).toEqual([{ recipe: bodyOf(extracted as ExtractedRecipe, editOf(extracted as ExtractedRecipe)).body }])
  // A stored recipe can be closed without being asked about.
  await page.getByRole('button', { name: 'Close recipe' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('closing an unsaved import asks first, and only "Close anyway" loses it', async ({ page }) => {
  await importText(page)
  await page.getByRole('button', { name: 'Close recipe' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Close it now and it’s gone')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Playwright pancakes' })).toBeVisible()
  await page.getByRole('button', { name: 'Close recipe' }).click()
  await page.getByRole('button', { name: 'Close anyway' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a lapsed session keeps the unsaved import through the sign-in', async ({ page }) => {
  await page.route('**/api/recipes', route => route.fulfill(answer(401)))
  await importText(page)
  await page.getByRole('button', { name: 'Add to my recipes' }).click()
  await expect(page.getByRole('alert')).toContainText('signed out')
  await page.unroute('**/api/recipes')
  await page.getByRole('button', { name: 'Sign in again' }).click()
  await expect(page.getByText('Test Cook', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Playwright pancakes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to my recipes' })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a server with no database says so, and a rejected body is treated as a bug', async ({ page }) => {
  let status = 503
  await page.route('**/api/recipes', route => route.fulfill(answer(status)))
  await importText(page)
  await page.getByRole('button', { name: 'Add to my recipes' }).click()
  await expect(page.getByRole('alert')).toContainText('Saving isn’t available right now')
  status = 422
  await page.getByRole('button', { name: 'Add to my recipes' }).click()
  await expect(page.getByRole('alert')).toContainText('Something went wrong while saving')
  await expect(page.getByText('upstream detail')).toHaveCount(0)
})

test('an added import is a real row, owned by the signed-in subject', async ({ page }) => {
  test.skip(!process.env.NUXT_DATABASE_URL, 'NUXT_DATABASE_URL is not set')
  await importText(page)
  await page.getByRole('button', { name: 'Add to my recipes' }).click()
  await expect(page.getByText('In your recipes')).toBeVisible()
  const sql = postgres(process.env.NUXT_DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const rows = await sql<{ owner_sub: string, source: { type: string } }[]>`SELECT owner_sub, source FROM recipes WHERE title = 'Playwright pancakes'`
    expect(rows.map(row => [row.owner_sub, row.source.type])).toEqual([['test-user', 'text']])
  } finally {
    await sql`DELETE FROM recipes WHERE owner_sub = 'test-user'`
    await sql.end()
  }
})
