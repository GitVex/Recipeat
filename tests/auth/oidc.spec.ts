import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { test, expect } from '@playwright/test'

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
