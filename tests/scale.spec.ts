import { test, expect, type Page } from '@playwright/test'

// Scaling a recipe while it is read, against a mocked API. The arithmetic and
// the rounding are tests/recipeScale.node.ts; this is what a reader does and
// sees. A reload is a request the mocks cannot reach, so keeping the scale
// through one is the cookie's business and not tested here.
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const text = (value: string) => ({ type: 'text', value })
const recipe = (id: string, title: string, portions: number | null) => ({
  id, title, image: null, totalTime: 30, portions, source_lang: 'en',
  ingredients: [
    { id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null },
    { id: 'ingredient_2', originalText: '1 tsp salt', name: 'salt', quantityText: '1 tsp', quantity: { value: 1, maxValue: null, unit: 'tsp' }, extra: null },
    { id: 'ingredient_3', originalText: 'olive oil to taste', name: 'olive oil', quantityText: null, quantity: null, extra: 'to taste' },
  ],
  steps: [
    {
      id: 'step_1', originalText: 'Mix 500 g flour, bake at 220 °C for 20 min.',
      parts: [text('Mix '), { type: 'ingredientQuantity', ingredientId: 'ingredient_1' }, text(' flour, bake at '), { type: 'measurement', quantity: 'temperature_1' }, text(' for '), { type: 'measurement', quantity: 'duration_1' }, text('.')],
      quantities: {
        temperature_1: { value: 220, maxValue: null, unit: 'celsius', kind: 'temperature', scaleWithPortions: false },
        duration_1: { value: 20, maxValue: null, unit: 'minute', kind: 'duration', scaleWithPortions: false },
      },
    },
  ],
  source: { type: 'text', originalText: '' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})
const summary = (full: ReturnType<typeof recipe>) => ({ ...full, ingredientCount: 3, stepCount: 1 })

async function open(page: Page, portions: number | null = 2) {
  const recipes = [recipe(ids[0], 'Focaccia', portions), recipe(ids[1], 'Ragù', 4)]
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: recipes.map(summary) } }))
  await page.route('**/api/recipes/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({ json: { recipe: recipes.find(entry => entry.id === id) } })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${ids[0]}`)
}

const lines = (page: Page) => page.locator('.detail-content ul li')
const stepText = (page: Page) => page.locator('.step-list li').first()

test('servings scale every amount that grows, and leave the oven and the timer', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 2')
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 3')
  await expect(lines(page).nth(0)).toContainText('750 g flour')
  await expect(lines(page).nth(1)).toContainText('1½ tsp salt')
  // Nothing to scale in it, and said so rather than left behind silently.
  await expect(lines(page).nth(2)).toContainText('not scaled')
  await expect(stepText(page)).toContainText('Mix 750 g flour, bake at 220 °C for 20 min.')
  await page.screenshot({ path: 'test-results/scale-portions.png', fullPage: true })

  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(lines(page).nth(0)).toContainText('500 g flour')
  await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0)
  await expect(lines(page).nth(2)).not.toContainText('not scaled')
  await expect(page.getByRole('button', { name: 'Fewer servings' })).toBeEnabled()
})

test('setting one ingredient scales the rest to it, and it reads exactly as typed', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /^Scale to how much flour you have/ }).click()
  const input = page.getByRole('textbox', { name: 'How much flour you have, in g' })
  await expect(input).toBeFocused()
  await input.fill('347')
  await input.press('Enter')
  const flour = page.getByRole('button', { name: /^Scale to how much flour you have: 347 g, set by you/ })
  await expect(flour).toHaveClass(/anchored/)
  // 347 / 500 of everything else, rounded to what can be measured.
  await expect(lines(page).nth(1)).toContainText('¾ tsp salt')
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 1.4')
  await expect(stepText(page)).toContainText('Mix 347 g flour')
  await page.screenshot({ path: 'test-results/scale-anchor.png', fullPage: true })

  // Stepping the servings takes over from the ingredient.
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 2')
  await expect(lines(page).nth(0)).toContainText('500 g flour')
})

test('a recipe that does not say how many it serves shows the factor instead', async ({ page }) => {
  await open(page, null)
  await expect(page.getByRole('group', { name: 'Servings' })).toHaveCount(0)
  await page.getByRole('button', { name: /^Scale to how much salt you have/ }).click()
  await page.getByRole('textbox', { name: 'How much salt you have, in tsp' }).fill('1.5')
  await page.keyboard.press('Enter')
  await expect(page.locator('.scale-factor')).toHaveText('×1.5')
  await expect(lines(page).nth(0)).toContainText('750 g flour')
})

test('editing shows the recipe as stored, and the scale is there again on the way back', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(lines(page).nth(0)).toContainText('750 g flour')
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await expect(page.locator('.edit-list li').first()).toContainText('500 g flour')
  await expect(page.getByRole('group', { name: 'Servings' })).toHaveCount(0)

  // With unsaved changes, reading would hide them: the switch holds.
  await page.getByRole('button', { name: /^Edit title/ }).click()
  await page.getByRole('textbox', { name: 'title' }).fill('Focaccia, changed')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('switch', { name: 'Edit recipe' })).toBeDisabled()
  await page.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click()
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await expect(lines(page).nth(0)).toContainText('750 g flour')
})

test('opening another recipe drops the scale', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(lines(page).nth(0)).toContainText('750 g flour')
  await page.locator('.collection-entry').nth(1).click()
  await expect(page).toHaveURL(`/recipes/${ids[1]}`)
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 4')
  await expect(lines(page).nth(0)).toContainText('500 g flour')
  await page.locator('.collection-entry').nth(0).click()
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 2')
  await expect(lines(page).nth(0)).toContainText('500 g flour')
})

// Signed in with preferences saved to the account (#62).
const preferring = (page: Page, preferences: { unitSystem: string | null, portions: number | null }) => {
  const writes: unknown[] = []
  return page.route('**/api/preferences', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().postDataJSON())
    return route.fulfill({ json: { preferences } })
  }).then(() => writes)
}

test('default servings open a recipe scaled to them, and by hand still wins', async ({ page }) => {
  await preferring(page, { unitSystem: null, portions: 4 })
  await open(page)
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 4')
  await expect(lines(page).nth(1)).toContainText('2 tsp salt')
  await page.getByRole('button', { name: 'Fewer servings' }).click()
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 3')
  // Reset is the recipe as written, not where it opened.
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 2')
  await expect(lines(page).nth(1)).toContainText('1 tsp salt')
  await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0)
})

test('a recipe that does not say how many it serves opens unscaled', async ({ page }) => {
  await preferring(page, { unitSystem: null, portions: 4 })
  await open(page, null)
  await expect(page.locator('.scale-factor')).toHaveCount(0)
  await expect(lines(page).nth(0)).toContainText('500 g flour')
})

test("the account's units show, and the toggle changes only this view", async ({ page }) => {
  const writes = await preferring(page, { unitSystem: 'imperial', portions: null })
  await open(page)
  const toggle = page.getByRole('switch', { name: 'Metric units' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(lines(page).nth(0)).not.toContainText('500 g')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(lines(page).nth(0)).toContainText('500 g flour')
  expect(writes).toEqual([])
  expect((await page.context().cookies()).some(cookie => cookie.name === 'recipeat-units')).toBe(false)
})
