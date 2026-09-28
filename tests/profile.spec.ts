import { test, expect, type Page } from '@playwright/test'

// The account page (#11). Signed in, against a mocked /api/me and listing;
// signed out, against the real server, which answers 401 without a session.
const me = { provider: 'zitadel', subject: '1234', profile: { sub: '1234', name: 'Ada Lovelace', preferred_username: 'ada', email: 'ada@example.com' } }
const card = (n: number, title: string) => ({
  id: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`, title, image: null, totalTime: null, portions: 2,
  ingredientCount: n, stepCount: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})

// Reached inside the app, so the requests go through the browser and the mocks.
async function visit(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.evaluate(() => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push('/profile'))
  await expect(page).toHaveURL(/\/profile$/)
}

test('the account page shows who is signed in and what they have kept', async ({ page }) => {
  let listed = 0
  await page.route('**/api/me', route => route.fulfill({ json: me }))
  await page.route('**/api/recipes', (route) => {
    listed++
    return route.fulfill({ json: { recipes: [card(1, 'Focaccia'), card(2, 'Ragù')] } })
  })
  await visit(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ada Lovelace')
  await expect(page.locator('.profile-details')).toContainText('ada@example.com')
  await expect(page.locator('.profile-details')).toContainText('ada')
  await expect(page.locator('.profile-details')).toContainText('Zitadel')

  // From the database, not this browser.
  const recipes = page.getByRole('region', { name: /Your recipes/ })
  await expect(recipes).toContainText('2')
  await expect(recipes.getByRole('link', { name: /Focaccia/ })).toHaveAttribute('href', `/recipes/${card(1, '').id}`)
  await expect(recipes.getByRole('link', { name: /Ragù/ })).toBeVisible()
  expect(listed).toBe(1)
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
  await expect(page).toHaveTitle('Ada Lovelace — Recipeat')
  await page.screenshot({ path: 'test-results/profile.png', fullPage: true })
})

test('an account with nothing saved says so', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { ...me, profile: { sub: '1234', preferred_username: 'ada' } } }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await visit(page)
  // No name: the username stands in, and is not listed twice.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ada')
  await expect(page.locator('.profile-details')).not.toContainText('Username')
  await expect(page.getByRole('region', { name: /Your recipes/ })).toContainText('Nothing saved yet')
})

test('a listing that fails is said, and the account still shows', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: me }))
  await page.route('**/api/recipes', route => route.fulfill({ status: 500, json: {} }))
  await visit(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ada Lovelace')
  await expect(page.getByRole('region', { name: /Your recipes/ }).getByRole('alert')).toContainText('couldn’t read your recipes')
})

test('signed out, the page says so rather than rendering empty', async ({ page }) => {
  const response = await page.goto('/profile')
  expect(response!.status()).toBe(401)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You’re not signed in.')
  await expect(page.locator('.collection-state').getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('.profile-card')).toHaveCount(0)
})
