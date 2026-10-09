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

// Setting the stove up (#109).
const offer = (page: Page) => page.locator('.stove-offer')

test('heat levels and no stove offer a way to set one up, which opens the Stove section', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { provider: 'zitadel', subject: '1234', profile: { name: 'Ada' } } }))
  await open(page, {})
  await expect(offer(page)).toHaveText('Set up your stove to see heat levels as its settings.')
  await offer(page).getByRole('link', { name: 'Set up your stove' }).click()
  await expect(page).toHaveURL(/\/profile#stove$/)
  const stove = page.locator('details#stove')
  await expect(stove).toHaveAttribute('open', '')
  await expect(stove.getByRole('radio', { name: 'Induction' })).toBeVisible()
})

test('a stove that shows settings, gas, or signed out is offered nothing', async ({ page }) => {
  for (const stove of [{ stoveKind: 'ceramic', stoveLowest: 1, stoveHighest: 9 }, { stoveKind: 'gas' }, null]) {
    await page.unrouteAll()
    await open(page, stove)
    await expect(step(page)).toBeVisible()
    await expect(offer(page)).toHaveCount(0)
  }
})

async function profile(page: Page, stove: Record<string, unknown>) {
  const writes: Record<string, unknown>[] = []
  let saved = { ...none, ...stove }
  await page.route('**/api/me', route => route.fulfill({ json: { provider: 'zitadel', subject: '1234', profile: { name: 'Ada' } } }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [] } }))
  await page.route('**/api/preferences', (route) => {
    if (route.request().method() === 'PUT') writes.push(saved = route.request().postDataJSON())
    return route.fulfill({ json: { preferences: saved } })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.evaluate(() => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push('/profile#stove'))
  await expect(page.locator('details#stove')).toHaveAttribute('open', '')
  return writes
}

test('the slider cuts the range where the stove\'s levels change, saves where it is let go, and goes back to the default', async ({ page }) => {
  const writes = await profile(page, { stoveKind: 'ceramic', stoveLowest: 1, stoveHighest: 9 })
  const stove = page.locator('details#stove')
  const medium = stove.getByRole('slider', { name: 'Medium starts at' })
  const high = stove.getByRole('slider', { name: 'High starts at' })
  // The cut points are the slider's, not boxes of their own.
  await expect(stove.locator('#preference-stoveMediumFrom')).toHaveCount(0)
  await expect(medium).toHaveValue('4')
  await expect(high).toHaveValue('7')
  await expect(stove.locator('.preference-slider .preference-hint')).toHaveText('Low 1–3 · Medium 4–6 · High 7–9')
  await expect(stove.getByRole('button', { name: 'Use the default' })).toHaveCount(0)
  // The range's ends over the track, each thumb's value over it, the areas under.
  await expect(stove.locator('.slider-above span')).toHaveText(['1', '9', '4', '7'])
  await expect(stove.locator('.slider-tick')).toHaveCount(9)
  await expect(stove.locator('.slider-below span')).toHaveText(['Low', 'Medium', 'High'])

  await high.focus()
  await page.keyboard.press('ArrowRight')
  await expect(stove.locator('.preference-slider .preference-hint')).toHaveText('Low 1–3 · Medium 4–7 · High 8–9')
  await expect.poll(() => writes.at(-1) && [writes.at(-1)!.stoveMediumFrom, writes.at(-1)!.stoveHighFrom]).toEqual([4, 8])

  // A thumb stops one short of the other.
  await medium.focus()
  await page.keyboard.press('End')
  await expect(medium).toHaveValue('7')
  await expect(stove.locator('.preference-slider .preference-hint')).toHaveText('Low 1–6 · Medium 7 · High 8–9')
  await expect(stove.locator('.slider-above span')).toHaveText(['1', '9', '7', '8'])
  await expect.poll(() => writes.at(-1) && [writes.at(-1)!.stoveMediumFrom, writes.at(-1)!.stoveHighFrom]).toEqual([7, 8])
  await page.screenshot({ path: 'test-results/heat-slider.png', fullPage: true })

  await stove.getByRole('button', { name: 'Use the default' }).click()
  await expect.poll(() => writes.at(-1) && [writes.at(-1)!.stoveMediumFrom, writes.at(-1)!.stoveHighFrom]).toEqual([null, null])
  await expect(medium).toHaveValue('4')
  await expect(high).toHaveValue('7')
})

test('no slider for gas, or before the range is known', async ({ page }) => {
  await profile(page, { stoveKind: 'ceramic', stoveLowest: 1, stoveHighest: 9 })
  const stove = page.locator('details#stove')
  await expect(stove.getByRole('slider')).toHaveCount(2)
  await stove.getByRole('radio', { name: 'Gas' }).check()
  await expect(stove.getByRole('slider')).toHaveCount(0)
  await stove.getByRole('radio', { name: 'Induction' }).check()
  await expect(stove.getByRole('slider')).toHaveCount(2)
  await stove.locator('#preference-stoveHighest').fill('')
  await stove.locator('#preference-stoveHighest').blur()
  await expect(stove.getByRole('slider')).toHaveCount(0)
})
