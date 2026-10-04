import { test, expect, type Page } from '@playwright/test'

// The nudge towards paper after a new version is saved (#66), against a mocked
// API. Saving itself is tests/writes.spec.ts; this is the line it leaves.
const root = '11111111-1111-4111-8111-111111111111'
const next = '22222222-2222-4222-8222-222222222222'
const recipe = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, image: null, totalTime: null, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Bake.', parts: [{ type: 'text', value: 'Bake.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
})
const nudge = (page: Page) => page.locator('.paper-nudge')

/** Opens the recipe and saves an edit to it as `choice`; answers the writes it saw. */
async function saveAs(page: Page, choice: 'new version' | 'separate recipe', paperNudge: string | null = null) {
  const rows = new Map([[root, recipe(root, 'Focaccia')]])
  let preferences = { unitSystem: null, portions: null, paperNudge, sharedIngredients: null }
  const writes: unknown[] = []
  await page.route('**/api/preferences', (route) => {
    if (route.request().method() === 'PUT') writes.push(preferences = route.request().postDataJSON())
    return route.fulfill({ json: { preferences } })
  })
  await page.route('**/api/recipes', route => route.fulfill({
    json: { recipes: [...rows.values()].filter(row => row.pinned).map(row => ({ ...row, ingredientCount: 1, stepCount: 1 })) },
  }))
  await page.route(/\/api\/recipes\/[^/?]+(\/(progressions|variants))?(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[3]!
    if (route.request().method() === 'GET') return route.fulfill({ json: { recipe: rows.get(id) } })
    const variant = url.pathname.endsWith('/variants')
    const made = recipe(next, 'Focaccia, better', variant ? { variantOf: root } : { lineId: root, progressionOf: root })
    if (!variant) rows.set(root, { ...rows.get(root)!, pinned: false })
    rows.set(next, made)
    return route.fulfill({ status: 201, json: { recipe: made } })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page.locator('.collection-pane')).toContainText('500 g flour')
  // Not on simply opening a recipe.
  await expect(nudge(page)).toHaveCount(0)
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await page.getByRole('button', { name: /^Edit title/ }).click()
  await page.getByRole('textbox', { name: 'title' }).fill('Focaccia, better')
  await page.keyboard.press('Tab')
  const bar = page.getByRole('region', { name: 'Unsaved changes' })
  if (choice === 'separate recipe') await bar.getByRole('radio', { name: /Separate recipe/ }).check()
  await bar.getByRole('button', { name: `Save as ${choice}` }).click()
  await expect(page).toHaveURL(`/recipes/${next}`)
  return writes
}

test('a new version gets the line under its title, once, and × hides it', async ({ page }) => {
  await saveAs(page, 'new version')
  await expect(nudge(page)).toContainText('Got this one right? It may deserve a page in your notebook.')
  // Under the title, before the ingredients.
  const title = await page.locator('.title-row').boundingBox()
  const line = await nudge(page).boundingBox()
  expect(line!.y).toBeGreaterThan(title!.y)
  await page.locator('.collection-pane').screenshot({ path: 'test-results/paper-nudge.png' })

  await page.evaluate(() => { (window as any).printed = 0; window.print = () => { (window as any).printed++ } })
  await nudge(page).getByRole('button', { name: 'Print' }).click()
  expect(await page.evaluate(() => (window as any).printed)).toBe(1)

  await nudge(page).getByRole('button', { name: 'Hide this' }).click()
  await expect(nudge(page)).toHaveCount(0)

  // Coming back to the same version is not the moment it was saved.
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${next}`)
  await expect(page.locator('.collection-pane')).toContainText('500 g flour')
  await expect(nudge(page)).toHaveCount(0)
})

test('"Don\'t suggest this" saves the preference and the line goes', async ({ page }) => {
  const writes = await saveAs(page, 'new version')
  await nudge(page).getByRole('button', { name: 'Don’t suggest this' }).click()
  await expect(nudge(page)).toHaveCount(0)
  expect(writes).toEqual([{ unitSystem: null, portions: null, paperNudge: 'off', sharedIngredients: null }])
})

test('with the preference off, a new version says nothing', async ({ page }) => {
  await saveAs(page, 'new version', 'off')
  await expect(page.locator('.collection-pane')).toContainText('Focaccia, better')
  await expect(nudge(page)).toHaveCount(0)
})

test('a separate recipe is not a new version, and gets no line', async ({ page }) => {
  await saveAs(page, 'separate recipe')
  await expect(page.locator('.collection-pane')).toContainText('Focaccia, better')
  await expect(nudge(page)).toHaveCount(0)
})

test('the profile page can turn it back on', async ({ page }) => {
  const writes: unknown[] = []
  await page.route('**/api/me', route => route.fulfill({ json: { provider: 'zitadel', subject: 'user', profile: { name: 'Ada' } } }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/preferences', (route) => {
    if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON())
    return route.fulfill({ json: { preferences: { unitSystem: null, portions: null, paperNudge: 'off', sharedIngredients: null } } })
  })
  // Reached inside the app, so the requests go through the browser and the mocks.
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.evaluate(() => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push('/profile'))
  await expect(page.getByRole('radio', { name: 'Don’t suggest it' })).toBeChecked()
  await page.getByRole('radio', { name: 'Suggest it', exact: true }).check()
  await expect.poll(() => writes).toEqual([{ unitSystem: null, portions: null, paperNudge: null, sharedIngredients: null }])
  await page.screenshot({ path: 'test-results/paper-nudge-profile.png', fullPage: true })
})
