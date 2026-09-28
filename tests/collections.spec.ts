import { test, expect, type Page } from '@playwright/test'

// The collections page (#71) and the collections under My recipes in the
// header (#73), against a mocked API that keeps its own state. Every visit is
// a client-side navigation, so the requests go through the mocks.
type Fake = {
  collections: { id: string, name: string, count: number, thumbnails: { id: string, title: string | null, image: string | null }[] }[]
  reads: number
  calls: string[]
}
const stamp = { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }
const thumb = (n: number, title: string | null, image: string | null = null) => ({ id: `${n}0000000-0000-4000-8000-000000000000`, title, image })
const weeknight = { id: '77777777-7777-4777-8777-777777777777', name: 'Weeknight', count: 5, thumbnails: [thumb(1, 'Focaccia'), thumb(2, 'Ragù'), thumb(3, null), thumb(4, 'Pho')] }
const christmas = { id: '88888888-8888-4888-8888-888888888888', name: 'Christmas 2026', count: 2, thumbnails: [thumb(5, 'Stollen'), thumb(6, 'Gravy')] }
const empty = { id: '99999999-9999-4999-8999-999999999999', name: 'Ragù night', count: 0, thumbnails: [] }
const fake = (): Fake => ({ collections: [weeknight, christmas, empty].map(c => structuredClone(c)), reads: 0, calls: [] })

async function mockApi(page: Page, state: Fake, { listStatus = 200 } = {}) {
  await page.route('**/api/collections', async (route) => {
    if (route.request().method() === 'GET') {
      state.reads++
      if (listStatus !== 200) return route.fulfill({ status: listStatus, json: { message: 'x' } })
      return route.fulfill({ json: { collections: state.collections.map(c => ({ ...c, ...stamp })) } })
    }
    const { name } = route.request().postDataJSON()
    state.calls.push(`POST ${name}`)
    if (state.collections.some(c => c.name.toLowerCase() === name.toLowerCase())) return route.fulfill({ status: 409, json: { message: 'x' } })
    const made = { id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${state.collections.length}`, name, count: 0, thumbnails: [] }
    state.collections.unshift(made)
    return route.fulfill({ status: 201, json: { collection: { id: made.id, name, ...stamp } } })
  })
  await page.route('**/api/collections/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    const method = route.request().method()
    if (method === 'PATCH') {
      const { name } = route.request().postDataJSON()
      state.calls.push(`PATCH ${id} ${name}`)
      if (state.collections.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return route.fulfill({ status: 409, json: { message: 'x' } })
      state.collections.find(c => c.id === id)!.name = name
      return route.fulfill({ json: { collection: { id, name, ...stamp, updatedAt: '2026-09-02T00:00:00.000Z' } } })
    }
    if (method === 'DELETE') {
      state.calls.push(`DELETE ${id}`)
      state.collections = state.collections.filter(c => c.id !== id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })
}

const hydrate = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
}
const go = (page: Page, path: string) =>
  page.evaluate(to => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push(to), path)
// The header asks whether anyone is signed in before it reads anything. The
// session is the module's own state; set it as a sign-in would.
const signIn = (page: Page) => page.evaluate(() => {
  const nuxt = (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$nuxt
  nuxt.payload.state['$snuxt-oidc-auth-session'] = { expireAt: Date.now() / 1000 + 3600, provider: 'zitadel', userInfo: { name: 'Ada' } }
})
const openPage = async (page: Page) => {
  await hydrate(page)
  await go(page, '/collections')
  await expect(page).toHaveURL(/\/collections$/)
}

// ── The page ───────────────────────────────────────────────────────────────

test('each collection is a card: its name, its count, and its first four as a mosaic', async ({ page }) => {
  await mockApi(page, fake())
  await openPage(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your collections.')
  const cards = page.locator('.collection-card')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0)).toContainText('Weeknight')
  await expect(cards.nth(0)).toContainText('5 recipes')
  // Four tiles, one a book for the recipe with no title.
  await expect(cards.nth(0).locator('.mosaic-cell .recipe-thumb')).toHaveCount(4)
  await expect(cards.nth(0).locator('.thumb-initial')).toHaveText(['F', 'R', 'P'])
  // Two recipes: two tiles filled, and two quiet ones rather than holes.
  await expect(cards.nth(1).locator('.mosaic-cell')).toHaveCount(4)
  await expect(cards.nth(1).locator('.mosaic-cell .recipe-thumb')).toHaveCount(2)
  // None: one mark for the whole card.
  await expect(cards.nth(2).locator('.collection-mosaic')).toHaveClass(/empty/)
  await expect(cards.nth(2)).toContainText('0 recipes')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/collections.png', fullPage: true })
})

test('the search bar filters the cards by name as you type, accents aside', async ({ page }) => {
  await mockApi(page, fake())
  await openPage(page)
  const search = page.getByRole('searchbox', { name: 'Search your collections' })
  await search.fill('ragu')
  await expect(page.locator('.collection-card')).toHaveCount(1)
  await expect(page.locator('.collection-card')).toContainText('Ragù night')
  await search.fill('CHRIST')
  await expect(page.locator('.collection-card')).toHaveText([/Christmas 2026/])
  await search.fill('sourdough')
  await expect(page.locator('.collection-card')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('No collection is called anything like “sourdough”')
  await search.fill('')
  await expect(page.locator('.collection-card')).toHaveCount(3)
})

test('a collection is made from the page, and a name already taken says so', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await openPage(page)
  await page.getByRole('button', { name: 'New collection' }).click()
  const name = page.getByLabel('New collection')
  await expect(name).toBeFocused()
  await name.fill('WEEKNIGHT')
  await name.press('Enter')
  await expect(page.getByRole('alert')).toContainText('You already have a collection called “WEEKNIGHT”.')
  await name.fill('Sunday bakes')
  await page.getByRole('button', { name: 'Make it' }).click()
  await expect(page.locator('.collection-card').first()).toContainText('Sunday bakes')
  await expect(page.getByLabel('New collection')).toHaveCount(0)
  expect(state.calls).toEqual(['POST WEEKNIGHT', 'POST Sunday bakes'])
})

test('a collection is renamed in its card, and Escape leaves it as it was', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await openPage(page)
  await page.getByRole('button', { name: 'Rename Christmas 2026' }).click()
  const input = page.getByLabel('New name for Christmas 2026')
  await expect(input).toBeFocused()
  await input.fill('Christmas 2027')
  await input.press('Escape')
  await expect(page.locator('.collection-card').nth(1)).toContainText('Christmas 2026')
  await expect(page.getByRole('button', { name: 'Rename Christmas 2026' })).toBeFocused()
  expect(state.calls).toEqual([])

  await page.getByRole('button', { name: 'Rename Christmas 2026' }).click()
  await input.fill('Weeknight')
  await input.press('Enter')
  await expect(page.getByRole('alert')).toContainText('You already have a collection called “Weeknight”.')
  await input.fill('Christmas 2027')
  await input.press('Enter')
  await expect(page.locator('.collection-card').nth(1)).toContainText('Christmas 2027')
  await expect(page.getByRole('button', { name: 'Rename Christmas 2027' })).toBeFocused()
})

test('deleting a collection says its recipes stay, and only the collection goes', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await openPage(page)
  await page.getByRole('button', { name: 'Delete Weeknight' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete “Weeknight”?' })
  await expect(dialog).toContainText('The 5 recipes in it stay in My recipes.')
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.getByRole('button', { name: 'Delete Weeknight' })).toBeFocused()
  expect(state.calls).toEqual([])

  await page.getByRole('button', { name: 'Delete Weeknight' }).click()
  await page.getByRole('button', { name: 'Delete collection' }).click()
  await expect(page.locator('.collection-card')).toHaveCount(2)
  await expect(page.locator('.toast')).toContainText('Its recipes are still in My recipes')
  expect(state.calls).toEqual([`DELETE ${weeknight.id}`])
})

test('no collections yet says so, and offers to make one', async ({ page }) => {
  const state = fake()
  state.collections = []
  await mockApi(page, state)
  await openPage(page)
  await expect(page.getByText('No collections yet.')).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Make your first collection' }).click()
  await expect(page.getByLabel('New collection')).toBeFocused()
})

test('a failed read says so and can be retried', async ({ page }) => {
  const state = fake()
  await mockApi(page, state, { listStatus: 500 })
  await openPage(page)
  await expect(page.getByRole('alert')).toContainText('We couldn’t open your collections.')
  await page.unrouteAll()
  await mockApi(page, state)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.collection-card')).toHaveCount(3)
})

test('signed out, the page asks for a sign-in', async ({ page }) => {
  await page.goto('/collections')
  await expect(page.getByText('Your collections are waiting.')).toBeVisible()
})

test('on a phone the cards are one column', async ({ page }) => {
  await mockApi(page, fake())
  await openPage(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const [first, second] = [await page.locator('.collection-card').nth(0).boundingBox(), await page.locator('.collection-card').nth(1).boundingBox()]
  expect(second!.x).toBeCloseTo(first!.x, 0)
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1)
  expect(first!.x + first!.width).toBeLessThanOrEqual(390)
})

// ── The header ─────────────────────────────────────────────────────────────

const nav = (page: Page) => page.getByRole('navigation')
const panel = (page: Page) => page.locator('#nav-collections')

test('the header says My recipes, and the import button says what it does', async ({ page }) => {
  await hydrate(page)
  await expect(nav(page).getByRole('link', { name: 'My recipes' })).toHaveAttribute('href', '/recipes')
  await expect(page.getByRole('button', { name: 'Add a recipe' })).toBeVisible()
  await expect(page.getByText(/My collection|Start your collection/)).toHaveCount(0)
})

test('resting on My recipes slides the collections down, read once, and leaving closes them', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await hydrate(page)
  await signIn(page)
  await nav(page).getByRole('link', { name: 'My recipes' }).hover()
  await expect(panel(page)).toBeVisible()
  await expect(nav(page).getByRole('button', { name: 'Your collections' })).toHaveAttribute('aria-expanded', 'true')
  await expect(panel(page).locator('.nav-collections-list li')).toHaveText([/Weeknight\s*5 recipes/, /Christmas 2026\s*2 recipes/, /Ragù night\s*0 recipes/])
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/header-collections.png' })
  // Onto the panel and down to its link without it closing.
  await panel(page).getByRole('link', { name: 'All collections' }).hover()
  await expect(panel(page)).toBeVisible()
  await page.mouse.move(5, 600)
  await expect(panel(page)).toBeHidden()
  await nav(page).getByRole('link', { name: 'My recipes' }).hover()
  await expect(panel(page)).toBeVisible()
  expect(state.reads).toBe(1)
  await panel(page).getByRole('link', { name: 'All collections' }).click()
  await expect(page).toHaveURL(/\/collections$/)
  await expect(panel(page)).toBeHidden()
})

test('by keyboard: focus opens it, Tab walks into it, Escape closes it', async ({ page }) => {
  await mockApi(page, fake())
  await hydrate(page)
  await signIn(page)
  await nav(page).getByRole('link', { name: 'My recipes' }).focus()
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(nav(page).getByRole('button', { name: 'Your collections' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel(page).getByRole('link', { name: 'All collections' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(nav(page).getByRole('button', { name: 'Your collections' })).toBeFocused()
  // The chevron alone opens and closes it, as a tap would.
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeHidden()
})

test('signed out, it says so and reads nothing', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await hydrate(page)
  await nav(page).getByRole('link', { name: 'My recipes' }).hover()
  await expect(panel(page)).toContainText('Sign in to keep recipes in collections.')
  expect(state.reads).toBe(0)
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('in the phone menu, a tap on the chevron opens the collections in place, and another closes them', async ({ page }) => {
    await mockApi(page, fake())
    await hydrate(page)
    await signIn(page)
    await page.getByRole('button', { name: 'Toggle navigation' }).tap()
    const chevron = nav(page).getByRole('button', { name: 'Your collections' })
    await chevron.tap()
    await expect(panel(page)).toContainText('Weeknight')
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    const box = await panel(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/header-collections-phone.png' })
    await chevron.tap()
    await expect(panel(page)).toBeHidden()
  })
})
