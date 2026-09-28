import { test, expect, type Page } from '@playwright/test'

// One collection opened (#72), against a mocked API that keeps its own state:
// the order, what is in it, and every write that reached it.
const ids = {
  focaccia: '11111111-1111-4111-8111-111111111111',
  ragu: '22222222-2222-4222-8222-222222222222',
  pho: '33333333-3333-4333-8333-333333333333',
  phoNewer: '44444444-4444-4444-8444-444444444444',
}
const collectionId = '77777777-7777-4777-8777-777777777777'
const stamp = { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }
const entry = (id: string, title: string, pinned = true, pinnedId = id) => ({
  id, title, image: null, totalTime: 25, portions: 2, ingredientCount: 3, stepCount: 2, ...stamp, pinned, pinnedId,
})
const recipe = (id: string, title: string) => ({
  ...entry(id, title), source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: 'flour', name: 'flour', quantityText: null, quantity: null, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Mix it.', parts: [{ type: 'text', value: 'Mix it.' }], quantities: {} }],
  source: { type: 'text', originalText: '' }, tags: [], lineId: id, progressionOf: null, variantOf: null,
})

type Fake = { name: string, recipes: ReturnType<typeof entry>[], calls: string[], gone: boolean }
const fake = (): Fake => ({
  name: 'Weeknight',
  recipes: [entry(ids.focaccia, 'Focaccia'), entry(ids.ragu, 'Ragù'), entry(ids.pho, 'Pho', false, ids.phoNewer)],
  calls: [],
  gone: false,
})

async function mockApi(page: Page, state: Fake, { orderStatus = 200 } = {}) {
  const detail = () => ({ collection: { id: collectionId, name: state.name, ...stamp, recipes: state.recipes } })
  const card = () => ({ id: collectionId, name: state.name, count: state.recipes.length, thumbnails: state.recipes.slice(0, 4).map(r => ({ id: r.id, title: r.title, image: null })), ...stamp })
  await page.route('**/api/collections', route => route.fulfill({ json: { collections: state.gone ? [] : [card()] } }))
  await page.route('**/api/collections/*', (route) => {
    const method = route.request().method()
    if (state.gone) return route.fulfill({ status: 404, json: { message: 'x' } })
    if (method === 'GET') return route.fulfill({ json: detail() })
    if (method === 'PATCH') {
      state.name = route.request().postDataJSON().name
      state.calls.push(`PATCH ${state.name}`)
      return route.fulfill({ json: { collection: { id: collectionId, name: state.name, ...stamp } } })
    }
    state.calls.push('DELETE collection')
    state.gone = true
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/collections/*/order', (route) => {
    const { recipeIds } = route.request().postDataJSON()
    state.calls.push(`ORDER ${recipeIds.map((id: string) => state.recipes.find(r => r.id === id)!.title).join(',')}`)
    if (orderStatus !== 200) {
      // Someone added one elsewhere meanwhile.
      state.recipes = [...state.recipes, entry('55555555-5555-4555-8555-555555555555', 'Dal')]
      return route.fulfill({ status: orderStatus, json: { message: 'x' } })
    }
    state.recipes = recipeIds.map((id: string) => state.recipes.find(r => r.id === id)!)
    return route.fulfill({ json: detail() })
  })
  await page.route('**/api/collections/*/recipes/*', (route) => {
    const recipeId = new URL(route.request().url()).pathname.split('/').pop()!
    state.calls.push(`OUT ${state.recipes.find(r => r.id === recipeId)!.title}`)
    state.recipes = state.recipes.filter(r => r.id !== recipeId)
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/recipes/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    return route.fulfill({ json: { recipe: recipe(id, id === ids.phoNewer ? 'Pho, spicier' : 'Something') } })
  })
}

const open = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.evaluate(() => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push('/collections'))
  await page.getByRole('link', { name: 'Weeknight' }).click()
  await expect(page).toHaveURL(`/collections/${collectionId}`)
  // The collections page fades out before this one comes in: until then its
  // buttons are the ones on screen.
  await expect(page.locator('.collection-page')).toBeVisible()
}
const titles = (page: Page) => page.locator('.order-row .entry-title')

test('a card opens its collection: the recipes in order, each opening the version added', async ({ page }) => {
  await mockApi(page, fake())
  await open(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Weeknight')
  await expect(titles(page)).toHaveText(['Focaccia', 'Ragù', 'Pho'])
  await expect(page.locator('.collection-page .eyebrow')).toHaveText('COLLECTION · 3 RECIPES')
  // Pho was added before a newer version was saved: it says so, and leads there.
  const pho = page.locator('.order-row').nth(2)
  await expect(pho).toContainText('Earlier version')
  await expect(pho.getByRole('link', { name: 'See the newest' })).toHaveAttribute('href', `/recipes/${ids.phoNewer}`)
  await expect(page.locator('.order-row').nth(0)).not.toContainText('Earlier version')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/collection-page.png', fullPage: true })
  await page.getByRole('link', { name: /^Focaccia/ }).click()
  await expect(page).toHaveURL(`/recipes/${ids.focaccia}`)
})

test('the move buttons reorder by keyboard, keep focus, and say where it went', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await open(page)
  const down = page.getByRole('button', { name: 'Move Focaccia down' })
  await down.focus()
  await page.keyboard.press('Enter')
  await expect(titles(page)).toHaveText(['Ragù', 'Focaccia', 'Pho'])
  await expect(down).toBeFocused()
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Focaccia moved to 2 of 3.')
  await page.keyboard.press('Enter')
  await expect(titles(page)).toHaveText(['Ragù', 'Pho', 'Focaccia'])
  // At the bottom there is no further down: focus moves to the way back up.
  await expect(page.getByRole('button', { name: 'Move Focaccia up' })).toBeFocused()
  await expect.poll(() => state.calls).toEqual(['ORDER Ragù,Focaccia,Pho', 'ORDER Ragù,Pho,Focaccia'])
  await expect(page.getByRole('button', { name: 'Move Ragù up' })).toBeDisabled()
})

test('dragging a row by its handle reorders it, and saves once when let go', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await open(page)
  const handle = page.locator('.order-handle').nth(0)
  const last = await page.locator('.order-row').nth(2).boundingBox()
  const from = await handle.boundingBox()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  // Past the middle of the last row, a step at a time as a hand would.
  await page.mouse.move(from!.x + from!.width / 2, last!.y + last!.height * 0.8, { steps: 12 })
  await expect(titles(page)).toHaveText(['Ragù', 'Pho', 'Focaccia'])
  expect(state.calls).toEqual([])
  await page.mouse.up()
  await expect.poll(() => state.calls).toEqual(['ORDER Ragù,Pho,Focaccia'])
})

test('an order refused because the collection changed elsewhere shows it as it is now', async ({ page }) => {
  await mockApi(page, fake(), { orderStatus: 409 })
  await open(page)
  await page.getByRole('button', { name: 'Move Focaccia down' }).click()
  await expect(page.getByRole('alert')).toContainText('This collection changed somewhere else.')
  await expect(titles(page)).toHaveText(['Focaccia', 'Ragù', 'Pho', 'Dal'])
})

test('taking a recipe out leaves the recipe, and says so', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await open(page)
  await page.getByRole('button', { name: 'Take Ragù out of this collection' }).click()
  await expect(titles(page)).toHaveText(['Focaccia', 'Pho'])
  await expect(page.locator('.toast')).toContainText('Ragù is out of this collection, and still in My recipes')
  expect(state.calls).toEqual(['OUT Ragù'])
  // Focus goes to what took its place.
  await expect(page.getByRole('link', { name: /^Pho/ })).toBeFocused()
})

test('the collection is renamed and deleted from its own page too', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await open(page)
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  const input = page.getByLabel('New name for Weeknight')
  await input.fill('Weeknights')
  await input.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Weeknights')
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeFocused()

  await page.getByRole('button', { name: 'Delete collection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete “Weeknights”?' })
  await expect(dialog).toContainText('The 3 recipes in it stay in My recipes.')
  await dialog.getByRole('button', { name: 'Delete collection' }).click()
  await expect(page).toHaveURL(/\/collections$/)
  await expect(page.getByText('No collections yet.')).toBeVisible()
  expect(state.calls).toEqual(['PATCH Weeknights', 'DELETE collection'])
})

test('a collection that is not there is not found, whoever asked', async ({ page }) => {
  const state = fake()
  await mockApi(page, state)
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  state.gone = true
  await page.evaluate(to => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push(to), `/collections/${collectionId}`)
  await expect(page.getByRole('alert')).toContainText('We couldn’t find that collection.')
  await page.getByRole('link', { name: 'Back to your collections' }).click()
  await expect(page).toHaveURL(/\/collections$/)
})

test('an empty collection says how to fill it', async ({ page }) => {
  const state = fake()
  state.recipes = []
  await mockApi(page, state)
  await open(page)
  await expect(page.getByText('Nothing in here yet.')).toBeVisible()
})

test('at phone width every row fits, controls and all', async ({ page }) => {
  await mockApi(page, fake())
  await open(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const row of await page.locator('.order-row').all()) {
    const box = await row.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }
  await expect(page.getByRole('button', { name: 'Take Pho out of this collection' })).toBeInViewport()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/collection-page-phone.png', fullPage: true })
})
