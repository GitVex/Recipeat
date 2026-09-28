import { test, expect, type Page } from '@playwright/test'

// Searching and filtering the collection (#14), against a mocked API. The
// filtering itself is the server's (tests/database.live.ts); the mock does a
// rough version of it so the page has something to show, and every test
// checks what was asked for — in the address and in the request.
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`
const recipe = (n: number, title: string, { tags = [] as string[], totalTime = null as number | null, portions = 2, source = 'text' } = {}) => ({
  id: id(n), lineId: id(n), title, image: null, totalTime, portions, tags,
  ingredients: [{ id: 'ingredient_1', originalText: '1 leek', name: 'leek', quantityText: '1', quantity: { value: 1, maxValue: null, unit: 'count' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Cook.', parts: [{ type: 'text', value: 'Cook.' }], quantities: {} }],
  source: { type: source, originalText: '' }, source_lang: 'en',
  progressionOf: null, variantOf: null, pinned: true,
  createdAt: `2026-09-0${n}T00:00:00.000Z`, updatedAt: `2026-09-0${n}T00:00:00.000Z`,
})
const rows = [
  recipe(3, 'Leek soup', { tags: ['Soup', 'Winter'], totalTime: 40, source: 'website' }),
  recipe(2, 'Tomato pasta', { tags: ['Weeknight'], totalTime: 20, source: 'photo' }),
  recipe(1, 'Sunday roast', { tags: ['Winter'], totalTime: 180, portions: 6 }),
]
const summary = (full: ReturnType<typeof recipe>) => ({ ...full, ingredientCount: 1, stepCount: 1 })

async function mockApi(page: Page) {
  const asked: URLSearchParams[] = []
  await page.route(/\/api\/recipes(\?.*)?$/, (route) => {
    const params = new URL(route.request().url()).searchParams
    asked.push(params)
    const q = params.get('q')?.toLowerCase()
    const tags = params.getAll('tag').map(tag => tag.toLowerCase())
    const maxTime = params.get('maxTime')
    const sources = params.getAll('source')
    const found = rows.filter(row =>
      (!q || row.title.toLowerCase().includes(q))
      && tags.every(tag => row.tags.some(t => t.toLowerCase() === tag))
      && (!maxTime || (row.totalTime !== null && row.totalTime <= Number(maxTime)))
      && (!sources.length || sources.includes(row.source.type)))
    return route.fulfill({ json: { recipes: found.map(summary) } })
  })
  await page.route('**/api/tags', route => route.fulfill({ json: { tags: [
    { name: 'Soup', count: 1 }, { name: 'Weeknight', count: 1 }, { name: 'Winter', count: 2 },
  ] } }))
  await page.route(/\/api\/recipes\/[^/?]+$/, (route) => {
    const want = new URL(route.request().url()).pathname.split('/')[3]
    return route.fulfill({ json: { recipe: rows.find(row => row.id === want) } })
  })
  return asked
}

const hydrate = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
}
const go = (page: Page, path: string) =>
  page.evaluate(to => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push(to), path)
const entries = (page: Page) => page.locator('.collection-entry .entry-title')
const openList = async (page: Page, path = '/recipes') => {
  await hydrate(page)
  await go(page, path)
  await expect(page.locator('.collection-entries, .collection-state').first()).toBeVisible()
}
const panel = (page: Page) => page.getByRole('region', { name: 'Filters' })

test('the search narrows the list by title, in the address and in the request', async ({ page }) => {
  const asked = await mockApi(page)
  await openList(page)
  await expect(entries(page)).toHaveText(['Leek soup', 'Tomato pasta', 'Sunday roast'])
  // Unfiltered, the list and the header's count are one read.
  expect(asked).toHaveLength(1)
  await page.getByRole('searchbox', { name: 'Search your recipes' }).fill('  SOUP ')
  await expect(page).toHaveURL(/\/recipes\?q=SOUP$/)
  await expect(entries(page)).toHaveText(['Leek soup'])
  expect(asked.at(-1)!.get('q')).toBe('SOUP')
  // The preview is of one the filter left, not the newest of them all.
  await expect(page.locator('.collection-preview')).toContainText('Leek soup')
  await page.getByRole('searchbox', { name: 'Search your recipes' }).fill('')
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(entries(page)).toHaveCount(3)
})

test('filters combine, each one narrowing what the others left', async ({ page }) => {
  const asked = await mockApi(page)
  await openList(page)
  const toggle = page.getByRole('button', { name: /^Filters/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('button', { name: 'Winter' }).click()
  await expect(entries(page)).toHaveText(['Leek soup', 'Sunday roast'])
  await expect(page).toHaveURL(/tag=Winter/)
  await panel(page).getByRole('button', { name: '1 h or less' }).click()
  await expect(entries(page)).toHaveText(['Leek soup'])
  expect(asked.at(-1)!.getAll('tag')).toEqual(['Winter'])
  expect(asked.at(-1)!.get('maxTime')).toBe('60')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/filters-open.png' })
  await expect(page.getByRole('button', { name: 'Filters, 2 on' })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Winter' })).toHaveAttribute('aria-pressed', 'true')
  // A source on top of those leaves nothing, and says so.
  await panel(page).getByRole('button', { name: 'A photo' }).click()
  await expect(entries(page)).toHaveCount(0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/filters-panel.png' })
})

test('an ingredient is added with Enter and taken off by its button', async ({ page }) => {
  const asked = await mockApi(page)
  await openList(page)
  await page.getByRole('button', { name: /^Filters/ }).click()
  const field = panel(page).getByLabel('Has an ingredient')
  await field.fill('leek')
  await field.press('Enter')
  await expect(page).toHaveURL(/ingredient=leek/)
  expect(asked.at(-1)!.getAll('ingredient')).toEqual(['leek'])
  await panel(page).getByRole('button', { name: 'Stop filtering by leek' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
})

test('a filtered address opens filtered, with the panel saying what is on', async ({ page }) => {
  const asked = await mockApi(page)
  await openList(page, '/recipes?tag=winter&maxTime=45&source=website')
  await expect(entries(page)).toHaveText(['Leek soup'])
  const last = asked.at(-1)!
  expect([last.getAll('tag'), last.get('maxTime'), last.getAll('source')]).toEqual([['winter'], '45', ['website']])
  await page.getByRole('button', { name: 'Filters, 3 on' }).click()
  // A tag asked for in another case is the tag; a time not among the choices
  // is shown as one.
  await expect(panel(page).getByRole('button', { name: 'Winter' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page).getByRole('button', { name: '45 min or less' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page).getByRole('button', { name: 'A website' })).toHaveAttribute('aria-pressed', 'true')
})

test('nothing matching says so, apart from having nothing, and clears back to everything', async ({ page }) => {
  await mockApi(page)
  await openList(page, '/recipes?q=sourdough')
  const state = page.getByRole('status')
  await expect(state).toContainText('Nothing matches.')
  await expect(state).toContainText('None of your recipes is called anything like “sourdough”')
  await expect(page.getByText('Nothing saved yet.')).toHaveCount(0)
  // The search is still there to change.
  await expect(page.getByRole('searchbox', { name: 'Search your recipes' })).toHaveValue('sourdough')
  await state.getByRole('button', { name: 'Clear the search' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(entries(page)).toHaveCount(3)
  await expect(page.getByRole('searchbox', { name: 'Search your recipes' })).toHaveValue('')

  await go(page, '/recipes?tag=Soup&source=photo')
  await expect(page.getByRole('status')).toContainText('No recipe fits all of that at once.')
  await page.getByRole('status').getByRole('button', { name: 'Clear filters' }).click()
  await expect(entries(page)).toHaveCount(3)
})

test('opening a recipe from a filtered list keeps the filters, and coming back finds them', async ({ page }) => {
  const asked = await mockApi(page)
  await openList(page, '/recipes?tag=Winter')
  await expect(entries(page)).toHaveText(['Leek soup', 'Sunday roast'])
  const reads = asked.length
  await page.locator('.collection-entry', { hasText: 'Sunday roast' }).click()
  await expect(page).toHaveURL(`/recipes/${id(1)}?tag=Winter`)
  await expect(page.locator('.collection-pane')).toContainText('1 leek')
  // Same filters, so the same list: not read again.
  expect(asked.length).toBe(reads)
  // The rail is the filtered list.
  await expect(page.locator('.collection-entry')).toHaveCount(2)
  await page.getByRole('link', { name: 'Show all your recipes' }).click()
  await expect(page).toHaveURL('/recipes?tag=Winter')
  await expect(entries(page)).toHaveText(['Leek soup', 'Sunday roast'])
})

test('the header still counts every recipe while the list is filtered', async ({ page }) => {
  await mockApi(page)
  await openList(page)
  await expect(page.getByRole('navigation').getByRole('link', { name: /My recipes/ })).toContainText('3')
  await page.getByRole('searchbox', { name: 'Search your recipes' }).fill('soup')
  await expect(entries(page)).toHaveText(['Leek soup'])
  await expect(page.getByRole('navigation').getByRole('link', { name: /My recipes/ })).toContainText('3')
})
