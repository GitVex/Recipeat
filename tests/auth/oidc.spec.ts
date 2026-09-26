import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { test, expect } from '@playwright/test'
import postgres from 'postgres'

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
