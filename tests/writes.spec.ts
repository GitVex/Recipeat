import { test, expect, type Page, type Route } from '@playwright/test'

// Saving an edit as a new version or a separate recipe (#30), and deleting a
// recipe (#50), against a mocked API. What the server does with a line is its
// own tests' business (tests/database.live.ts); here the answers are written
// by hand, and the test checks what was asked and where the page goes.
const ids = {
  root: '11111111-1111-4111-8111-111111111111',
  next: '22222222-2222-4222-8222-222222222222',
  other: '33333333-3333-4333-8333-333333333333',
  made: '44444444-4444-4444-8444-444444444444',
}
const recipe = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, image: null, totalTime: null, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Bake.', parts: [{ type: 'text', value: 'Bake.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
})
const summary = (full: ReturnType<typeof recipe>) => ({ ...full, ingredientCount: 1, stepCount: 1 })

type Handler = (route: Route, id: string, url: URL) => Promise<void> | void
/**
 * `rows` is what the server holds; the listing and each read answer from it,
 * so a test changes what is there by changing `rows`. `write` answers every
 * request that is not a plain read.
 */
async function mockApi(page: Page, rows: Map<string, ReturnType<typeof recipe>>, write: Handler) {
  const listings: number[] = []
  await page.route('**/api/recipes', route => {
    listings.push(Date.now())
    return route.fulfill({ json: { recipes: [...rows.values()].filter(row => row.pinned).map(summary) } })
  })
  await page.route(/\/api\/recipes\/[^/?]+(\/(progressions|variants))?(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[3]!
    if (route.request().method() === 'GET') {
      const row = rows.get(id)
      return row ? route.fulfill({ json: { recipe: row } }) : route.fulfill({ status: 404, json: { message: 'No such recipe.' } })
    }
    return write(route, id, url)
  })
  return listings
}

const open = async (page: Page, index = 0) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').nth(index).click()
  await expect(page.locator('.collection-pane')).toContainText('500 g flour')
}
const changeTitle = async (page: Page, title: string) => {
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await page.getByRole('button', { name: /^Edit title/ }).click()
  await page.getByRole('textbox', { name: 'title' }).fill(title)
  await page.keyboard.press('Tab')
}
const bar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' })
const toast = (page: Page) => page.locator('.toast')

test('the three saves are one choice, a new version the one already chosen, and overwriting marked as the one that loses something', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')]])
  await mockApi(page, rows, route => route.abort())
  await open(page)
  await changeTitle(page, 'Focaccia, better')
  const choices = bar(page).getByRole('radio')
  await expect(choices).toHaveCount(3)
  // Told apart by what they say, not where they sit.
  await expect(bar(page).getByRole('radio', { name: /New version.*stays in its history/ })).toBeChecked()
  await expect(bar(page).getByRole('radio', { name: /Separate recipe.*stays exactly as it is/ })).not.toBeChecked()
  const overwrite = bar(page).getByRole('radio', { name: /Overwrite this version.*gone/ })
  await expect(overwrite).not.toBeChecked()
  await expect(bar(page).getByRole('button', { name: 'Save as new version' })).not.toHaveClass(/destructive/)
  // Reachable by keyboard like any radio group.
  await bar(page).getByRole('radio', { name: /New version/ }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(overwrite).toBeChecked()
  await expect(bar(page).getByRole('button', { name: 'Overwrite' })).toHaveClass(/destructive/)
  await page.screenshot({ path: 'test-results/writes-choice.png', fullPage: true })
})

test('a new version is written from this one, and the page moves to it', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')]])
  let sent: any
  let release = () => {}
  const listings = await mockApi(page, rows, async (route, id, url) => {
    expect(url.pathname).toBe(`/api/recipes/${id}/progressions`)
    sent = route.request().postDataJSON()
    await new Promise<void>(resolve => (release = resolve))
    // The server's answer: a new row in the line, holding the pin.
    const made = recipe(ids.next, sent.recipe.title, { lineId: ids.root, progressionOf: ids.root })
    rows.set(ids.root, { ...rows.get(ids.root)!, pinned: false })
    rows.set(ids.next, made)
    return route.fulfill({ status: 201, json: { recipe: made } })
  })
  await open(page)
  await changeTitle(page, 'Focaccia, better')
  const listed = listings.length
  await bar(page).getByRole('button', { name: 'Save as new version' }).click()
  // While it is out, it says so, and nothing can be sent twice.
  await expect(bar(page).getByRole('button', { name: 'Saving new version…' })).toBeDisabled()
  await expect.poll(() => sent).toBeTruthy()
  release()
  await expect(page).toHaveURL(`/recipes/${ids.next}`)
  await expect(toast(page)).toContainText('Saved as a new version')
  await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('Focaccia, better')
  await expect(bar(page)).toHaveCount(0)
  // The line's entry in the collection is now the new version.
  await expect.poll(() => listings.length).toBeGreaterThan(listed)
  await expect(page.locator('.collection-entry')).toHaveCount(1)
  await expect(page.locator('.collection-entry').first()).toHaveAttribute('href', `/recipes/${ids.next}`)
  expect(sent.recipe.title).toBe('Focaccia, better')
})

test('a separate recipe is written and joins the collection beside this one', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')]])
  await mockApi(page, rows, (route, id, url) => {
    expect(url.pathname).toBe(`/api/recipes/${id}/variants`)
    const made = recipe(ids.made, route.request().postDataJSON().recipe.title, { variantOf: ids.root })
    rows.set(ids.made, made)
    return route.fulfill({ status: 201, json: { recipe: made } })
  })
  await open(page)
  await changeTitle(page, 'Focaccia with olives')
  await bar(page).getByRole('radio', { name: /Separate recipe/ }).check()
  await bar(page).getByRole('button', { name: 'Save as separate recipe' }).click()
  await expect(page).toHaveURL(`/recipes/${ids.made}`)
  await expect(toast(page)).toContainText('Saved as a separate recipe')
  await expect(page.locator('.collection-entry')).toHaveCount(2)
  await expect(page.locator('.collection-entry').first()).toContainText('Focaccia with olives')
})

test('a save that fails says why, claims nothing, and keeps the edit', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')]])
  await mockApi(page, rows, route => route.fulfill({ status: 409, json: { message: 'x' } }))
  await open(page)
  await changeTitle(page, 'Focaccia, better')
  await bar(page).getByRole('button', { name: 'Save as new version' }).click()
  await expect(bar(page).getByRole('alert')).toContainText('changed while it was being saved')
  await expect(page).toHaveURL(`/recipes/${ids.root}`)
  await expect(toast(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('Focaccia, better')
  await expect(bar(page).getByRole('button', { name: 'Save as new version' })).toBeEnabled()
})

test('deleting a recipe on its own says so, and it leaves the collection', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')], [ids.other, recipe(ids.other, 'Ragù', { createdAt: '2026-08-01T00:00:00.000Z' })]])
  const asked: string[] = []
  await mockApi(page, rows, (route, id, url) => {
    asked.push(url.search)
    if (url.searchParams.get('dryRun') !== 'true') rows.delete(id)
    return route.fulfill({ json: { deletion: { count: 1, ids: [id], pinned: null } } })
  })
  await open(page)
  await page.getByRole('button', { name: 'Delete recipe' }).click()
  const question = page.getByRole('dialog', { name: 'Delete this recipe?' })
  await expect(question).toContainText('gone for good')
  // The safe answer is the one under the cursor.
  await expect(question.getByRole('button', { name: 'Keep it' })).toBeFocused()
  expect(asked).toEqual(['?dryRun=true'])
  await question.getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(toast(page)).toContainText('Recipe deleted')
  await expect(page.locator('.collection-entry')).toHaveCount(1)
  await expect(page.locator('.collection-entry')).toContainText('Ragù')
  expect(asked).toEqual(['?dryRun=true', ''])
})

test('deleting a version with later ones names how many go, and the collection shows what is left', async ({ page }) => {
  // Three versions in a line: the root, then this one, pinned, with two after
  // it in a branch that is deleted with it. The pin goes back to the root.
  const rows = new Map([
    [ids.root, recipe(ids.root, 'Focaccia', { pinned: false })],
    [ids.next, recipe(ids.next, 'Focaccia, better', { lineId: ids.root, progressionOf: ids.root })],
  ])
  await mockApi(page, rows, (route, id, url) => {
    const dry = url.searchParams.get('dryRun') === 'true'
    if (!dry) {
      rows.delete(id)
      rows.set(ids.root, { ...rows.get(ids.root)!, pinned: true })
    }
    return route.fulfill({ json: { deletion: { count: 3, ids: [id, 'x', 'y'], pinned: ids.root } } })
  })
  await open(page)
  await page.getByRole('button', { name: 'Delete recipe' }).click()
  const question = page.getByRole('dialog', { name: 'Delete this recipe and 2 later versions?' })
  await expect(question).toContainText('every version that came after it')
  // What branched off as a separate recipe is not counted, and not implied.
  await expect(question).not.toContainText(/separate|variant/i)
  await page.screenshot({ path: 'test-results/writes-delete.png' })
  await question.getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(`/recipes/${ids.root}`)
  await expect(toast(page)).toContainText('Deleted 3 versions')
  await expect(page.locator('.collection-entry')).toHaveCount(1)
  await expect(page.locator('.collection-entry').first()).toHaveAttribute('href', `/recipes/${ids.root}`)
})

test('a recipe already gone when it is deleted is treated as deleted', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')]])
  await mockApi(page, rows, (route, id, url) => {
    if (url.searchParams.get('dryRun') === 'true') return route.fulfill({ json: { deletion: { count: 1, ids: [id], pinned: null } } })
    // Deleted from another tab in the meantime.
    rows.delete(id)
    return route.fulfill({ status: 404, json: { message: 'No such recipe.' } })
  })
  await open(page)
  await page.getByRole('button', { name: 'Delete recipe' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Nothing saved yet.')).toBeVisible()
})

test('a delete that fails says so and deletes nothing', async ({ page }) => {
  const rows = new Map([[ids.root, recipe(ids.root, 'Focaccia')]])
  await mockApi(page, rows, (route, id, url) => url.searchParams.get('dryRun') === 'true'
    ? route.fulfill({ json: { deletion: { count: 1, ids: [id], pinned: null } } })
    : route.fulfill({ status: 409, json: { message: 'x' } }))
  await open(page)
  await page.getByRole('button', { name: 'Delete recipe' }).click()
  const question = page.getByRole('dialog')
  await question.getByRole('button', { name: 'Delete' }).click()
  await expect(question.getByRole('alert')).toContainText('Nothing was deleted')
  await question.getByRole('button', { name: 'Keep it' }).click()
  await expect(page).toHaveURL(`/recipes/${ids.root}`)
  await expect(page.locator('.collection-pane')).toContainText('Focaccia')
})
