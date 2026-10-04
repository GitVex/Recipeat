import { test, expect, type Page } from '@playwright/test'

// The collection picker (#70) against a mocked API that keeps its own state,
// so a tick can be seen to reach the server and to come back from it. Every
// test arrives by clicking through from the landing page, for the reason
// collection.spec.ts gives.
const ids = { focaccia: '11111111-1111-4111-8111-111111111111', ragu: '22222222-2222-4222-8222-222222222222' }
const summary = (id: string, title: string) => ({
  id, title, image: null, totalTime: 25, portions: 2, ingredientCount: 1, stepCount: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})
const listing = [summary(ids.focaccia, 'Focaccia'), summary(ids.ragu, 'Ragù')]
const full = (id: string, pinned = true) => ({
  ...listing.find(recipe => recipe.id === id)!,
  source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: 'flour', name: 'flour', quantityText: null, quantity: null, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Mix it.', parts: [{ type: 'text', value: 'Mix it.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned,
})

type Fake = { collections: { id: string, name: string, members: string[] }[], calls: string[] }

async function mockApi(page: Page, fake: Fake, { pinned = true, failAdd = false, failContaining = false } = {}) {
  const card = (c: Fake['collections'][number]) => ({
    id: c.id, name: c.name, count: c.members.length, thumbnails: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })
  const inAny = (id: string) => fake.collections.some(c => c.members.includes(id))
  await page.route('**/api/recipes', route => route.fulfill({
    json: { recipes: listing.map(recipe => ({ ...recipe, inCollection: inAny(recipe.id) })) },
  }))
  await page.route('**/api/recipes/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    return route.fulfill({ json: { recipe: full(id, pinned) } })
  })
  await page.route('**/api/recipes/*/collections', (route) => {
    if (failContaining) return route.fulfill({ status: 500, json: { message: 'x' } })
    const id = new URL(route.request().url()).pathname.split('/')[3]!
    return route.fulfill({ json: { collections: fake.collections.filter(c => c.members.includes(id)).map(c => c.id) } })
  })
  await page.route('**/api/collections', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { collections: fake.collections.map(card) } })
    const { name } = route.request().postDataJSON()
    fake.calls.push(`POST ${name}`)
    if (fake.collections.some(c => c.name.toLowerCase() === name.toLowerCase()))
      return route.fulfill({ status: 409, json: { message: 'x' } })
    const made = { id: `99999999-9999-4999-8999-99999999999${fake.collections.length}`, name, members: [] }
    fake.collections.unshift(made)
    return route.fulfill({ status: 201, json: { collection: card(made) } })
  })
  await page.route('**/api/collections/*/recipes/*', (route) => {
    const [, , , collectionId, , recipeId] = new URL(route.request().url()).pathname.split('/')
    const method = route.request().method()
    fake.calls.push(`${method} ${collectionId} ${recipeId}`)
    if (failAdd && method === 'PUT') return route.fulfill({ status: 500, json: { message: 'x' } })
    const collection = fake.collections.find(c => c.id === collectionId)!
    if (method === 'PUT' && !collection.members.includes(recipeId!)) collection.members.push(recipeId!)
    if (method === 'DELETE') collection.members = collection.members.filter(member => member !== recipeId)
    return route.fulfill({ status: 204 })
  })
}

const openCollection = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await expect(page).toHaveURL(/\/recipes$/)
}

const weeknight = '77777777-7777-4777-8777-777777777777'
const christmas = '88888888-8888-4888-8888-888888888888'
const twoCollections = (): Fake => ({
  collections: [
    { id: christmas, name: 'Christmas 2026', members: [] },
    { id: weeknight, name: 'Weeknight', members: [ids.ragu] },
  ],
  calls: [],
})

test('from the recipe page: ticks show where it is, and ticking adds and removes', async ({ page }) => {
  const fake = twoCollections()
  await mockApi(page, fake)
  await openCollection(page)
  await page.locator('.collection-entry').nth(1).click()
  await expect(page).toHaveURL(`/recipes/${ids.ragu}`)

  await page.getByRole('button', { name: 'In a collection' }).click()
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  await expect(dialog).toContainText('Ragù')
  // The latest version: nothing to warn about.
  await expect(dialog.getByRole('note')).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /Christmas 2026/ })).not.toBeChecked()
  await expect(dialog.getByText('1 recipe', { exact: true })).toBeVisible()

  await dialog.getByRole('checkbox', { name: /Christmas 2026/ }).check()
  await expect(dialog.getByRole('checkbox', { name: /Christmas 2026/ })).toBeChecked()
  await dialog.getByRole('checkbox', { name: /Weeknight/ }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).not.toBeChecked()
  expect(fake.calls).toEqual([`PUT ${christmas} ${ids.ragu}`, `DELETE ${weeknight} ${ids.ragu}`])
  // The counts are read back from the server, not guessed.
  await expect(dialog.locator('.picker-option', { hasText: 'Christmas 2026' })).toContainText('1 recipe')
  await expect(dialog.locator('.picker-option', { hasText: 'Weeknight' })).toContainText('0 recipes')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/picker.png' })

  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
  // Focus goes back where it came from, still in one collection.
  await expect(page.getByRole('button', { name: 'In a collection' })).toBeFocused()
})

test('a new collection is made from the picker, and the recipe goes straight in', async ({ page }) => {
  const fake = twoCollections()
  await mockApi(page, fake)
  await openCollection(page)
  await page.locator('.collection-entry').nth(0).click()
  await page.getByRole('button', { name: 'Add to collection' }).click()
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  const name = dialog.getByLabel('New collection')

  // A name already taken, whatever its case, says so and makes nothing.
  await name.fill('weeknight')
  await name.press('Enter')
  await expect(dialog.getByRole('alert')).toContainText('You already have a collection called “weeknight”.')

  await name.fill('  Sunday bakes ')
  await dialog.getByRole('button', { name: 'Make and add' }).click()
  await expect(dialog.getByRole('checkbox', { name: /Sunday bakes/ })).toBeChecked()
  await expect(name).toHaveValue('')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  const made = fake.collections.find(c => c.name === 'Sunday bakes')!
  expect(made.members).toEqual([ids.focaccia])
  expect(fake.calls.slice(-2)).toEqual(['POST Sunday bakes', `PUT ${made.id} ${ids.focaccia}`])
})

test('on an earlier version, the picker says which version it adds', async ({ page }) => {
  await mockApi(page, twoCollections(), { pinned: false })
  await openCollection(page)
  await page.locator('.collection-entry').nth(0).click()
  await expect(page.getByText('An earlier version.')).toBeVisible()
  await page.getByRole('button', { name: 'Add to collection' }).click()
  await expect(page.getByRole('dialog').getByRole('note')).toContainText('it will show this one, not the newest')
})

test('from the list, by keyboard alone', async ({ page }) => {
  const fake = twoCollections()
  await mockApi(page, fake)
  await openCollection(page)
  // Tab from the entry to its button beside it.
  await page.locator('.collection-entry').nth(0).focus()
  await page.keyboard.press('Tab')
  const button = page.getByRole('button', { name: 'Add Focaccia to a collection' })
  await expect(button).toBeFocused()
  await expect(button).toHaveCSS('opacity', '1')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).not.toBeChecked()
  // Into the list, and space ticks.
  await dialog.getByRole('checkbox', { name: /Weeknight/ }).focus()
  await page.keyboard.press('Space')
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).toBeChecked()
  expect(fake.calls).toEqual([`PUT ${weeknight} ${ids.focaccia}`])
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(button).toBeFocused()
})

test('a tick the server refuses goes back, and says so', async ({ page }) => {
  await mockApi(page, twoCollections(), { failAdd: true })
  await openCollection(page)
  await page.getByRole('button', { name: 'Add Focaccia to a collection' }).click()
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  await dialog.getByRole('checkbox', { name: /Christmas 2026/ }).click()
  await expect(dialog.getByRole('alert')).toContainText('It couldn’t be added.')
  await expect(dialog.getByRole('checkbox', { name: /Christmas 2026/ })).not.toBeChecked()
})

test('at phone width the picker fits, and works from the list', async ({ page }) => {
  await mockApi(page, twoCollections())
  await openCollection(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const button = page.getByRole('button', { name: 'Ragù is in a collection' })
  // No pointer to reveal it with, on a real phone; here, it is still reachable.
  await button.click()
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).toBeChecked()
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  await expect(dialog.getByRole('button', { name: 'Make and add' })).toBeInViewport()
  // Settled, not caught half way through rising in.
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/picker-phone.png' })
})

// #128: the bookmark on the recipe page is filled while this version is in a
// collection, and follows what the picker did once it closes.
const bookmark = (page: Page) => page.locator('.add-to-collection svg')

test('the recipe page bookmark fills while the version is in a collection', async ({ page }) => {
  await mockApi(page, twoCollections())
  await openCollection(page)
  await page.locator('.collection-entry').nth(0).click()
  await expect(page).toHaveURL(`/recipes/${ids.focaccia}`)
  const add = page.getByRole('button', { name: 'Add to collection' })
  await expect(bookmark(page)).toHaveAttribute('fill', 'none')

  await add.click()
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  await dialog.getByRole('checkbox', { name: /Weeknight/ }).check()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'In a collection' })).toBeVisible()
  await expect(bookmark(page)).toHaveAttribute('fill', 'currentColor')

  // Taken out of the last one, it empties again.
  await page.getByRole('button', { name: 'In a collection' }).click()
  await dialog.getByRole('checkbox', { name: /Weeknight/ }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(add).toBeVisible()
  await expect(bookmark(page)).toHaveAttribute('fill', 'none')

  // A collection made from the picker counts too.
  await add.click()
  await dialog.getByLabel('New collection').fill('Sunday bakes')
  await dialog.getByRole('button', { name: 'Make and add' }).click()
  await expect(dialog.getByRole('checkbox', { name: /Sunday bakes/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(bookmark(page)).toHaveAttribute('fill', 'currentColor')
  // Other bookmarks on the recipe are not touched.
  await expect(page.locator('.collection-pane svg[fill="currentColor"]')).toHaveCount(1)
})

test('a membership that cannot be read shows the outline and no error', async ({ page }) => {
  await mockApi(page, twoCollections(), { failContaining: true })
  await openCollection(page)
  await page.locator('.collection-entry').nth(1).click()
  await expect(page).toHaveURL(`/recipes/${ids.ragu}`)
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible()
  await expect(bookmark(page)).toHaveAttribute('fill', 'none')
  await expect(page.getByRole('alert')).toHaveCount(0)
  // The picker is still there, and it is what says the read failed.
  await page.getByRole('button', { name: 'Add to collection' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('couldn’t be read')
})

test('the list fills the bookmark of a recipe in a collection, and follows the picker', async ({ page }) => {
  await mockApi(page, twoCollections())
  await openCollection(page)
  const entryBookmark = (title: string) => page.locator('li', { hasText: title }).locator('.entry-add svg')
  // Ragù starts in Weeknight; Focaccia in nothing.
  await expect(page.getByRole('button', { name: 'Ragù is in a collection' })).toBeAttached()
  await expect(entryBookmark('Ragù')).toHaveAttribute('fill', 'currentColor')
  await expect(entryBookmark('Focaccia')).toHaveAttribute('fill', 'none')

  await page.getByRole('button', { name: 'Add Focaccia to a collection' }).click()
  const dialog = page.getByRole('dialog', { name: /Add to a collection/ })
  await dialog.getByRole('checkbox', { name: /Christmas 2026/ }).check()
  await expect(dialog.getByRole('checkbox', { name: /Christmas 2026/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Focaccia is in a collection' })).toBeAttached()
  await expect(entryBookmark('Focaccia')).toHaveAttribute('fill', 'currentColor')

  await page.getByRole('button', { name: 'Ragù is in a collection' }).click()
  await dialog.getByRole('checkbox', { name: /Weeknight/ }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: /Weeknight/ })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Add Ragù to a collection' })).toBeAttached()
  await expect(entryBookmark('Ragù')).toHaveAttribute('fill', 'none')
})
