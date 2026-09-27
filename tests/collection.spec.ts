import { test, expect, type Page } from '@playwright/test'

// The collection page against a mocked API. The mocks only reach requests the
// browser makes, so every test arrives by clicking through from the landing
// page — a client-side navigation — rather than by loading /recipes, whose
// first read happens on the server.
const summary = (id: string, title: string | null, image: string | null, extra = {}) => ({
  id, title, image, totalTime: 25, portions: 2, ingredientCount: 3, stepCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
})
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
const listing = [
  summary(ids[0], 'Focaccia', null),
  summary(ids[1], null, null, { totalTime: null, portions: null }),
  summary(ids[2], 'Ragù', null),
]
const full = (id: string) => {
  const entry = listing.find(recipe => recipe.id === id)!
  return {
    ...entry,
    source_lang: 'en',
    ingredients: [{ id: 'ingredient_1', originalText: `flour for ${entry.title ?? 'untitled'}`, name: `flour for ${entry.title ?? 'untitled'}`, quantityText: null, quantity: null, extra: null }],
    steps: [{ id: 'step_1', originalText: 'Mix it.', parts: [{ type: 'text', value: 'Mix it.' }], quantities: {} }],
    source: { type: 'text', originalText: '' },
    lineId: id, progressionOf: null, variantOf: null, pinned: true,
  }
}

async function mockApi(page: Page, list: { status: number, body?: unknown }) {
  await page.route('**/api/recipes', route => route.fulfill({ status: list.status, json: list.body ?? { message: 'x' } }))
  await page.route('**/api/recipes/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    return ids.includes(id) ? route.fulfill({ json: { recipe: full(id) } }) : route.fulfill({ status: 404, json: { message: 'No such recipe.' } })
  })
}

const openCollection = async (page: Page) => {
  await page.goto('/')
  // Before hydration the link is a plain anchor, and following it loads
  // /recipes from the server — past the mocks, and signed out.
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My collection/ }).click()
  await expect(page).toHaveURL(/\/recipes$/)
}

test('the collection lists what the server returns, and previews what is under the pointer', async ({ page }) => {
  await mockApi(page, { status: 200, body: { recipes: listing } })
  await openCollection(page)
  const entries = page.locator('.collection-entry')
  await expect(entries).toHaveCount(3)
  // A null title reads as a deliberate placeholder, not an empty row.
  await expect(entries.nth(1)).toContainText('Untitled recipe')
  await expect(entries.nth(1).locator('.entry-title')).toHaveClass(/untitled/)
  await expect(entries.nth(0).locator('.thumb-initial')).toHaveText('F')
  // The header counts what the list holds, now that it has been read.
  await expect(page.getByRole('navigation').locator('.count')).toHaveText('3')

  const preview = page.getByRole('region', { name: 'Preview' })
  await expect(preview).toContainText('Focaccia')
  await entries.nth(2).hover()
  await expect(preview).toContainText('Ragù')
  await expect(preview).toContainText('flour for Ragù')
  await entries.nth(0).focus()
  await expect(preview).toContainText('Focaccia')
  await page.screenshot({ path: 'test-results/collection.png', fullPage: true })
})

test('opening a recipe folds the list into a rail and gives it its own address', async ({ page }) => {
  await mockApi(page, { status: 200, body: { recipes: listing } })
  await openCollection(page)
  await page.locator('.collection-entry').nth(2).click()
  await expect(page).toHaveURL(`/recipes/${ids[2]}`)
  await expect(page.locator('.collection')).toHaveClass(/folded/)
  await expect(page.locator('.collection-pane')).toContainText('flour for Ragù')
  await expect(page.locator('.collection-entry').nth(2)).toHaveAttribute('aria-current', 'page')
  await page.screenshot({ path: 'test-results/collection-open.png', fullPage: true })

  const toggle = page.getByRole('button', { name: 'Show your recipes' })
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Hide your recipes' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.collection-entry').nth(0).locator('.entry-title')).toBeVisible()
  await page.locator('.collection-entry').nth(0).click()
  await expect(page).toHaveURL(`/recipes/${ids[0]}`)
  await expect(page.locator('.collection-pane')).toContainText('flour for Focaccia')
  await expect(page.locator('.collection')).not.toHaveClass(/rail-open/)
})

test('opening the rail lays itself over the recipe, which stays where and as wide as it was', async ({ page }) => {
  await mockApi(page, { status: 200, body: { recipes: listing } })
  await openCollection(page)
  await page.locator('.collection-entry').nth(2).click()
  await expect(page.locator('.collection-pane')).toContainText('flour for Ragù')

  // Desktop, and then a phone: the viewport changes under the open recipe, so
  // the mocks still answer.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const pane = page.locator('.collection-pane')
    // The fold animates the columns; measure once it has settled.
    await page.waitForTimeout(400)
    const closed = await pane.boundingBox()
    await page.getByRole('button', { name: 'Show your recipes' }).click()
    await expect(page.locator('.collection-entry').nth(0).locator('.entry-title')).toBeVisible()
    expect(await pane.boundingBox()).toEqual(closed)
    await page.screenshot({ path: `test-results/collection-rail-${viewport.width}.png` })
    await page.getByRole('button', { name: 'Hide your recipes' }).click()
    expect(await pane.boundingBox()).toEqual(closed)
  }
})

test('an empty collection says so, and offers a way in', async ({ page }) => {
  await mockApi(page, { status: 200, body: { recipes: [] } })
  await openCollection(page)
  await expect(page.getByText('Nothing saved yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('a failed read says so and can be retried', async ({ page }) => {
  await mockApi(page, { status: 500 })
  await openCollection(page)
  await expect(page.getByRole('alert')).toContainText('We couldn’t open your collection.')
  await page.unroute('**/api/recipes')
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: listing } }))
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.collection-entry')).toHaveCount(3)
})

test('signed out, the collection asks for a sign-in, loaded directly or navigated to', async ({ page }) => {
  await page.goto('/recipes')
  await expect(page.getByText('Your collection is waiting.')).toBeVisible()
  await openCollection(page)
  await expect(page.getByText('Your collection is waiting.')).toBeVisible()
})

test('a recipe that is not there is not found, not forbidden', async ({ page }) => {
  // Listed a moment ago, deleted since: the read of it is a 404.
  const gone = summary('44444444-4444-4444-8444-444444444444', 'Deleted meanwhile', null)
  await mockApi(page, { status: 200, body: { recipes: [gone] } })
  await openCollection(page)
  await page.locator('.collection-entry').first().click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t find that recipe.')
  await page.getByRole('link', { name: 'Back to your collection' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
})
