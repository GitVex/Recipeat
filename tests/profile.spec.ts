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

test('preferences are saved to the account as they change', async ({ page }) => {
  const writes: unknown[] = []
  await page.route('**/api/me', route => route.fulfill({ json: me }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/preferences', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { preferences: { unitSystem: null, portions: null, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null } } })
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ json: { preferences: body } })
  })
  await visit(page)
  const preferences = page.getByRole('region', { name: 'Preferences' })
  await expect(preferences.getByRole('radio', { name: 'As written' })).toBeChecked()

  await preferences.getByRole('radio', { name: 'Imperial' }).check()
  await expect(preferences.getByRole('status')).toHaveText('Saved to your account.')
  await preferences.getByRole('spinbutton', { name: 'Servings' }).fill('4')
  await preferences.getByRole('spinbutton', { name: 'Servings' }).press('Enter')
  await expect.poll(() => writes.length).toBe(2)
  expect(writes).toEqual([{ unitSystem: 'imperial', portions: null, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }, { unitSystem: 'imperial', portions: 4, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }])
  await page.screenshot({ path: 'test-results/profile-preferences.png', fullPage: true })
})

test('a preference that does not save says so, and shows what is saved', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: me }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/preferences', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { preferences: { unitSystem: 'metric', portions: 2, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null } } })
    : route.fulfill({ status: 500, json: {} }))
  await visit(page)
  const preferences = page.getByRole('region', { name: 'Preferences' })
  // A click, not check(): the form is back on Metric before check() could see Imperial.
  await preferences.getByRole('radio', { name: 'Imperial' }).click()
  await expect(preferences.getByRole('status')).toHaveText('That didn’t save. Try again.')
  await expect(preferences.getByRole('radio', { name: 'Metric' })).toBeChecked()
  await expect(preferences.getByRole('spinbutton', { name: 'Servings' })).toHaveValue('2')
})

// Themes (#87): a whole look, switched with no reload.
const theme = (page: Page) => page.locator('html').getAttribute('data-theme')

test('a theme chosen on the account changes the look at once and is saved', async ({ page }) => {
  const writes: unknown[] = []
  await page.route('**/api/me', route => route.fulfill({ json: me }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/preferences', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { preferences: { unitSystem: null, portions: null, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null } } })
    writes.push(route.request().postDataJSON())
    return route.fulfill({ json: { preferences: route.request().postDataJSON() } })
  })
  await visit(page)
  const preferences = page.getByRole('region', { name: 'Preferences' })
  await expect(preferences.getByRole('radio', { name: 'Kitchen notebook' })).toBeChecked()
  expect(await theme(page)).toBeNull()
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
  await preferences.getByRole('radio', { name: 'Crate Label' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'crate-label')
  await expect(page.locator('link[href*="Rokkitt"]')).toHaveCount(1)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-display'))).toContain('Rokkitt')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).not.toBe(before)
  expect(writes).toEqual([{ unitSystem: null, portions: null, paperNudge: null, theme: 'crate-label', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }])
  await page.screenshot({ path: 'test-results/profile-crate-label.png', fullPage: true })

  await preferences.getByRole('radio', { name: 'Kitchen notebook' }).check()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
  await expect(page.locator('link[href*="Rokkitt"]')).toHaveCount(0)
})

test('signed out, a theme is kept in a cookie and rendered by the server', async ({ page }) => {
  await page.goto('/profile')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('radio', { name: 'Crate Label' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'crate-label')
  expect((await page.context().cookies()).find(c => c.name === 'recipeat-theme')?.value).toBe('crate-label')

  // The page arrives themed: no default first.
  const html = await (await page.request.get('/')).text()
  expect(html).toMatch(/<html[^>]*data-theme="crate-label"/)
  expect(html).toContain('Rokkitt')
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Crate Label' })).toBeChecked()

  await page.getByRole('radio', { name: 'Kitchen notebook' }).check()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
  expect(await (await page.request.get('/')).text()).not.toMatch(/data-theme=/)
})

test('Crate Label is dark on screen, and printing stays ink on white', async ({ page }) => {
  await page.goto('/profile')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('radio', { name: 'Crate Label' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'crate-label')
  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
  expect(await background()).toBe('rgb(20, 27, 46)')
  await page.emulateMedia({ media: 'print' })
  expect(await background()).toBe('rgb(255, 255, 255)')
})

test('Crate Label’s effects each switch off on their own, and only show with it', async ({ page }) => {
  const writes: unknown[] = []
  let preferences: Record<string, unknown> = {
    unitSystem: null, portions: null, paperNudge: null, theme: 'crate-label',
    grainEffect: 'off', stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null,
  }
  await page.route('**/api/me', route => route.fulfill({ json: me }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/preferences', (route) => {
    if (route.request().method() === 'PUT') writes.push(preferences = route.request().postDataJSON())
    return route.fulfill({ json: { preferences } })
  })
  await visit(page)
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-plain', 'grain')
  const panel = page.locator('.profile-card')
  expect(await panel.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none')

  // Folded under the Theme row until opened.
  await expect(page.getByRole('radiogroup', { name: 'Halftone photos' })).toBeHidden()
  await page.getByText('Crate Label effects').click()
  const halftone = page.getByRole('radiogroup', { name: 'Halftone photos' })
  await halftone.getByRole('radio', { name: 'Off' }).check()
  await expect(html).toHaveAttribute('data-plain', 'grain halftone')
  expect(writes.at(-1)).toMatchObject({ grainEffect: 'off', halftoneEffect: 'off' })

  await page.getByRole('radiogroup', { name: 'Paper grain' }).getByRole('radio', { name: 'On' }).check()
  await expect(html).toHaveAttribute('data-plain', 'halftone')
  expect(await panel.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('data:image/svg+xml')

  // Banners: the notched shape is behind the button, so its focus ring is whole.
  const signOut = page.getByRole('button', { name: 'Sign out' }).first()
  const banner = () => signOut.evaluate(el => getComputedStyle(el, '::before').clipPath)
  expect(await banner()).toContain('polygon')
  expect(await signOut.evaluate(el => getComputedStyle(el).clipPath)).toBe('none')
  await page.getByRole('radiogroup', { name: 'Tickets and banners' }).getByRole('radio', { name: 'Off' }).check()
  await expect(html).toHaveAttribute('data-plain', 'halftone ticket')
  expect(await banner()).toBe('none')

  // The default theme has none of them, so its form does not show them.
  await page.getByRole('radio', { name: 'Kitchen notebook' }).check()
  await expect(html).not.toHaveAttribute('data-theme', /./)
  await expect(html).not.toHaveAttribute('data-plain', /./)
  await expect(page.getByText('Crate Label effects')).toHaveCount(0)
  await expect(page.getByRole('radiogroup', { name: 'Halftone photos' })).toHaveCount(0)
})
