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

test('opening a recipe folds the list into a rail, and the rail opens the list again', async ({ page }) => {
  await mockApi(page, { status: 200, body: { recipes: listing } })
  await openCollection(page)
  await page.locator('.collection-entry').nth(2).click()
  await expect(page).toHaveURL(`/recipes/${ids[2]}`)
  await expect(page.locator('.collection')).toHaveClass(/folded/)
  await expect(page.locator('.collection-pane')).toContainText('flour for Ragù')
  await expect(page.locator('.collection-entry').nth(2)).toHaveAttribute('aria-current', 'page')
  await page.screenshot({ path: 'test-results/collection-open.png', fullPage: true })

  await page.getByRole('link', { name: 'Show all your recipes' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(page.locator('.collection')).not.toHaveClass(/folded/)
  // Back where it was opened from, previewing the recipe just left.
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('flour for Ragù')
  await page.locator('.collection-entry').nth(0).click()
  await expect(page).toHaveURL(`/recipes/${ids[0]}`)
  await expect(page.locator('.collection-pane')).toContainText('flour for Focaccia')
})

test('folding slides the list away under the pictures, and the recipe widens to the left after it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockApi(page, { status: 200, body: { recipes: listing } })
  await openCollection(page)
  const thumb = page.locator('.recipe-thumb').nth(2)
  const pane = page.locator('.collection-pane')
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('flour for Focaccia')
  const list = { thumb: await thumb.boundingBox(), pane: await pane.boundingBox() }

  await page.locator('.collection-entry').nth(2).click()
  await expect(pane).toContainText('flour for Ragù')
  // The columns move; measure once they have settled.
  await page.waitForTimeout(500)
  const folded = { thumb: await thumb.boundingBox(), pane: await pane.boundingBox() }
  expect(folded.thumb).toEqual(list.thumb)
  expect(folded.pane!.x).toBeLessThan(list.pane!.x - 200)
  expect(folded.pane!.x + folded.pane!.width).toBeCloseTo(list.pane!.x + list.pane!.width, 0)
  // The words are still there to be read out, only not seen.
  await expect(page.locator('.collection-entry').nth(2)).toHaveAccessibleName(/Ragù/)
  await expect(page.locator('.entry-text').nth(2)).toHaveCSS('opacity', '0')

  await page.getByRole('link', { name: 'Show all your recipes' }).click()
  await page.waitForTimeout(500)
  expect(await thumb.boundingBox()).toEqual(list.thumb)
  expect((await pane.boundingBox())!.x).toBeCloseTo(list.pane!.x, 0)
  await expect(page.locator('.entry-text').nth(2)).toHaveCSS('opacity', '1')
})

test('on a phone the list is the page, and the toggle goes back to it', async ({ page }) => {
  await mockApi(page, { status: 200, body: { recipes: listing } })
  // The header's links are behind its menu on a phone: in first, then small.
  await openCollection(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const entries = page.locator('.collection-entry')
  await expect(entries.nth(2)).toBeVisible()
  await expect(page.locator('.collection-pane')).toBeHidden()
  await entries.nth(2).click()
  await expect(page.locator('.collection-pane')).toContainText('flour for Ragù')
  await expect(entries.nth(2)).toBeHidden()
  await page.getByRole('link', { name: 'Show all your recipes' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(entries.nth(2)).toBeVisible()
})

test('a recipe that cannot be opened says so in the pane, and the list is still one click away', async ({ page }) => {
  const states = { '44444444-4444-4444-8444-444444444444': 404, '55555555-5555-4555-8555-555555555555': 401, '66666666-6666-4666-8666-666666666666': 500 }
  const entries = Object.keys(states).map((id, index) => summary(id, `State ${index}`, null))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: entries } }))
  await page.route('**/api/recipes/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() as keyof typeof states
    return route.fulfill({ status: states[id], json: { message: 'x' } })
  })
  await openCollection(page)
  const expected = ['We couldn’t find that recipe.', 'Sign in to open this recipe.', 'We couldn’t open this recipe.']
  for (const [index, text] of expected.entries()) {
    await page.locator('.collection-entry').nth(index).click()
    await expect(page.locator('.collection-pane')).toContainText(text)
    await page.getByRole('link', { name: 'Show all your recipes' }).click()
    await expect(page).toHaveURL(/\/recipes$/)
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
