import { test, expect, type Page } from '@playwright/test'

// Tags (#13): put on and taken off a recipe on its own page, and read in the
// list, the preview and the landing page's cards. Against a mocked API that
// keeps a line's tags the way the server does — case-folded, A to Z.
const ids = {
  bread: '11111111-1111-4111-8111-111111111111',
  soup: '22222222-2222-4222-8222-222222222222',
}
const recipe = (id: string, title: string, tags: string[] = []) => ({
  id, title, image: null, totalTime: 30, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Bake.', parts: [{ type: 'text', value: 'Bake.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  tags, lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})
const summary = (full: ReturnType<typeof recipe>) => ({ ...full, ingredientCount: 1, stepCount: 1 })
const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())

type State = { rows: Map<string, ReturnType<typeof recipe>>, puts: string[][], failPut?: number }

async function mockApi(page: Page, state: State) {
  await page.route('**/api/recipes', route =>
    route.fulfill({ json: { recipes: [...state.rows.values()].map(summary) } }))
  await page.route('**/api/tags', (route) => {
    const counts = new Map<string, number>()
    for (const row of state.rows.values()) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return route.fulfill({ json: { tags: [...counts].sort(([a], [b]) => byName(a, b)).map(([name, count]) => ({ name, count })) } })
  })
  await page.route(/\/api\/recipes\/[^/]+\/tags$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3]!
    const { tags } = route.request().postDataJSON() as { tags: string[] }
    state.puts.push(tags)
    if (state.failPut) return route.fulfill({ status: state.failPut, json: { message: 'x' } })
    // An existing tag in another case is that tag, as first written.
    const known = [...state.rows.values()].flatMap(row => row.tags)
    const stored = tags.map(tag => known.find(k => k.toLowerCase() === tag.toLowerCase()) ?? tag).sort(byName)
    state.rows.get(id)!.tags = stored
    return route.fulfill({ json: { tags: stored } })
  })
  await page.route(/\/api\/recipes\/[^/?]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3]!
    return route.fulfill({ json: { recipe: state.rows.get(id) } })
  })
}

const fresh = (): State => ({
  rows: new Map([
    [ids.bread, recipe(ids.bread, 'Focaccia', ['Baking', 'weekend'])],
    [ids.soup, recipe(ids.soup, 'Leek soup')],
  ]),
  puts: [],
})

const openList = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await expect(page.locator('.collection-entry')).toHaveCount(2)
}
const openRecipe = async (page: Page, title: string) => {
  await openList(page)
  await page.locator('.collection-entry', { hasText: title }).click()
  await expect(page.locator('.collection-pane')).toContainText('500 g flour')
}
const editor = (page: Page) => page.locator('.tag-editor')
const chips = (page: Page) => editor(page).locator('.tag')

test('the list shows each recipe’s tags, and a recipe with none shows nothing for them', async ({ page }) => {
  await mockApi(page, fresh())
  await openList(page)
  const [bread, soup] = [page.locator('.collection-entry', { hasText: 'Focaccia' }), page.locator('.collection-entry', { hasText: 'Leek soup' })]
  await expect(bread.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Baking', 'weekend'])
  await expect(soup.getByRole('list', { name: 'Tags' })).toHaveCount(0)
  // The preview of the one under the pointer reads them too.
  await bread.hover()
  await expect(page.locator('.collection-preview').getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Baking', 'weekend'])
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/tags-list.png' })
})

test('a tag is put on with Enter, and comes back in its first case and in order', async ({ page }) => {
  const state = fresh()
  await mockApi(page, state)
  await openRecipe(page, 'Focaccia')
  await expect(chips(page)).toHaveText(['Baking', 'weekend'])
  const field = page.getByRole('combobox', { name: 'Add a tag' })
  await field.fill('  bread   and  butter ')
  await field.press('Enter')
  await expect(chips(page)).toHaveText(['Baking', 'bread and butter', 'weekend'])
  expect(state.puts.at(-1)).toEqual(['Baking', 'weekend', 'bread and butter'])
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/tags-recipe.png' })
  // One already on it, in another case, is not sent again.
  await field.fill('BAKING')
  await field.press('Enter')
  await expect(field).toHaveValue('')
  expect(state.puts).toHaveLength(1)
  // The list's entry wears the new one without being read again.
  await page.getByRole('link', { name: 'Show all your recipes' }).click()
  await expect(page.locator('.collection-entry', { hasText: 'Focaccia' }).getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Baking', 'bread and butter', 'weekend'])
})

test('a comma puts a tag on too, and a tag used elsewhere is suggested and taken as written', async ({ page }) => {
  const state = fresh()
  await mockApi(page, state)
  await openRecipe(page, 'Leek soup')
  await expect(chips(page)).toHaveCount(0)
  await expect(page.locator('#tag-suggestions option')).toHaveCount(2)
  const field = page.getByRole('combobox', { name: 'Add a tag' })
  await field.fill('WEEKEND')
  await field.press(',')
  await expect(chips(page)).toHaveText(['weekend'])
  expect(state.puts.at(-1)).toEqual(['weekend'])
  // What it wears is no longer suggested.
  await expect(page.locator('#tag-suggestions option')).toHaveCount(1)
})

test('a tag is taken off by its button', async ({ page }) => {
  const state = fresh()
  await mockApi(page, state)
  await openRecipe(page, 'Focaccia')
  await page.getByRole('button', { name: 'Remove the tag weekend' }).click()
  await expect(chips(page)).toHaveText(['Baking'])
  expect(state.puts.at(-1)).toEqual(['Baking'])
})

test('a tag the server refuses is taken back off, and says why', async ({ page }) => {
  const state = { ...fresh(), failPut: 500 }
  await mockApi(page, state)
  await openRecipe(page, 'Focaccia')
  const field = page.getByRole('combobox', { name: 'Add a tag' })
  await field.fill('Sourdough')
  await field.press('Enter')
  await expect(editor(page).getByRole('alert')).toHaveText('That didn’t work. Try again.')
  await expect(chips(page)).toHaveText(['Baking', 'weekend'])
  // What was typed is still there to try again.
  await expect(field).toHaveValue('Sourdough')
})

test('a name too long is refused before it is sent', async ({ page }) => {
  const state = fresh()
  await mockApi(page, state)
  await openRecipe(page, 'Focaccia')
  const field = page.getByRole('combobox', { name: 'Add a tag' })
  await field.fill('x'.repeat(41))
  await field.press('Enter')
  await expect(editor(page).getByRole('alert')).toContainText('40 characters')
  expect(state.puts).toHaveLength(0)
})

test('tagging while an edit is unsaved keeps the edit', async ({ page }) => {
  const state = fresh()
  await mockApi(page, state)
  await openRecipe(page, 'Focaccia')
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await page.getByRole('button', { name: /^Edit title/ }).click()
  await page.getByRole('textbox', { name: 'title' }).fill('Focaccia, better')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
  const field = page.getByRole('combobox', { name: 'Add a tag' })
  await field.fill('Italian')
  await field.press('Enter')
  await expect(chips(page)).toHaveText(['Baking', 'Italian', 'weekend'])
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
  await expect(page.locator('.collection-pane')).toContainText('Focaccia, better')
})

test('the landing page’s samples wear tags on their cards', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.recipe-card').first().getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Weeknight', 'Vegetarian'])
})
