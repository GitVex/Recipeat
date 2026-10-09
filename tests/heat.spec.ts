import { test, expect, type Page } from '@playwright/test'

// A heat level's setting on the cook's stove (#110), against a mocked API. Which
// setting a level means is tests/heat.node.ts; this is what a reader sees.
const id = '11111111-1111-4111-8111-111111111111'
const text = (value: string) => ({ type: 'text', value })
const recipe = {
  id, title: 'Onions', image: null, totalTime: 30, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g onions', name: 'onions', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{
    id: 'step_1', originalText: 'Fry the onions over medium-high heat, then reduce the heat to low.',
    parts: [text('Fry the onions over '), { type: 'heat', level: 'medium-high', value: 'medium-high heat' }, text(', then reduce the '), { type: 'heat', level: 'low', value: 'heat to low' }, text('.')],
    quantities: {},
  }],
  source: { type: 'text', originalText: '' }, tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}
const none = {
  unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null,
  grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null,
  stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null,
}

// Signed in with this stove, or signed out (null), the way the server answers.
async function open(page: Page, stove: Record<string, unknown> | null) {
  await page.route('**/api/preferences', route => stove
    ? route.fulfill({ json: { preferences: { ...none, ...stove } } })
    : route.fulfill({ status: 401, json: {} }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...recipe, ingredientCount: 1, stepCount: 1 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe } }))
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
}
const step = (page: Page) => page.locator('.step-list li').first()
const AS_WRITTEN = '1.Fry the onions over medium-high heat, then reduce the heat to low.'

test('a heat level shows its setting on the stove beside the words', async ({ page }) => {
  await open(page, { stoveKind: 'ceramic', stoveLowest: 1, stoveHighest: 9 })
  await expect(step(page)).toHaveText('1.Fry the onions over medium-high heat · 6–7, then reduce the heat to low · 1–3.')
  await expect(step(page).locator('.heat-setting')).toHaveText([' · 6–7', ' · 1–3'])
  await page.screenshot({ path: 'test-results/heat-settings.png', fullPage: true })
})

test('the cook\'s own cuts move the setting, and scaling leaves it alone', async ({ page }) => {
  await open(page, { stoveKind: 'induction', stoveLowest: 1, stoveHighest: 9, stoveMediumFrom: 3, stoveHighFrom: 8 })
  await expect(step(page)).toHaveText('1.Fry the onions over medium-high heat · 7–8, then reduce the heat to low · 1–2.')
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(step(page)).toHaveText('1.Fry the onions over medium-high heat · 7–8, then reduce the heat to low · 1–2.')
})

test('gas, no stove, or signed out: the step reads as written', async ({ page }) => {
  for (const stove of [{ stoveKind: 'gas', stoveLowest: 1, stoveHighest: 9 }, {}, null]) {
    await page.unrouteAll()
    await open(page, stove)
    await expect(step(page)).toHaveText(AS_WRITTEN)
    await expect(step(page).locator('.heat-setting')).toHaveCount(0)
  }
})
