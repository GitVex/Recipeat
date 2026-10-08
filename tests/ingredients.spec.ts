import { test, expect, type Page } from '@playwright/test'

// "Does this recipe mean bay leaves?" (#173), against a mocked API: asked
// only of a cook who contributes, one answer per line, and new questions
// arriving over Server-Sent Events without a reload.
const id = '33333333-3333-4333-8333-333333333333'
const line = (n: number, name: string) => ({ id: `ingredient_${n}`, originalText: name, name, quantityText: null, quantity: null, extra: null })
const recipe = {
  id, title: 'Ragù', image: null, totalTime: null, portions: 2, source_lang: 'en',
  ingredients: [line(1, 'bay leafs'), line(2, 'tomatto')],
  steps: [{ id: 'step_1', originalText: 'Simmer.', parts: [{ type: 'text', value: 'Simmer.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}
const preferences = (ingredientMatching: 'on' | null) => ({
  unitSystem: null, portions: null, paperNudge: null, ingredientMatching, theme: null,
  grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null,
})
const bayLeaves = { lineId: 'ingredient_1', name: 'bay leafs', candidates: [{ ingredientId: '7', name: 'bay leaves' }, { ingredientId: '8', name: 'bay laurel' }] }
const tomato = { lineId: 'ingredient_2', name: 'tomatto', candidates: [{ ingredientId: '9', name: 'tomato' }] }

async function open(page: Page, { optedIn = true, questions = [bayLeaves, tomato] as object[], later = null as object[] | null } = {}) {
  const asked: unknown[] = []
  const answers: unknown[] = []
  let current = { recipe, lang: 'en', questions }
  await page.route('**/api/preferences', route => route.fulfill({ json: { preferences: preferences(optedIn ? 'on' : null) } }))
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...recipe, ingredientCount: 2, stepCount: 1 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe: current.recipe } }))
  await page.route('**/api/recipes/*/ingredients', (route) => {
    if (route.request().method() === 'GET') {
      asked.push(route.request().url())
      return route.fulfill({ json: { lang: current.lang, questions: current.questions } })
    }
    const body = route.request().postDataJSON()
    answers.push(body)
    const left = current.questions.filter(q => (q as { lineId: string }).lineId !== body.lineId)
    const changed = body.answer === 'typo'
      ? { ...current.recipe, ingredients: current.recipe.ingredients.map(l => l.id === body.lineId ? { ...l, name: 'tomato' } : l) }
      : current.recipe
    current = { ...current, recipe: changed, questions: left }
    return route.fulfill({ json: { recipe: changed, lang: 'en', questions: left } })
  })
  // Opened after the first read: what it then says arrives as news.
  await page.route('**/api/recipes/*/ingredients/events', async (route) => {
    await expect.poll(() => asked.length).toBeGreaterThan(0)
    if (later) current = { ...current, questions: later }
    return route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: later ? 'retry: 60000\nevent: matched\ndata: x\n\n' : 'retry: 60000\n\n' })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
  return { asked, answers }
}

// A line's mark, and the bubble it opens.
const mark = (page: Page, name: string) => page.getByRole('button', { name: `Check “${name}”` })
async function question(page: Page, name: string) {
  await mark(page, name).click()
  return page.getByRole('dialog', { name: `Your “${name}”` })
}

test('asked only of a cook who contributes, with each line\'s candidates', async ({ page }) => {
  const { asked } = await open(page, { optedIn: false })
  await expect(page.getByRole('heading', { name: 'Ragù' }).first()).toBeVisible()
  await expect(page.locator('.ingredient-mark')).toHaveCount(0)
  expect(asked).toHaveLength(0)
})

test('"Same thing, my name" answers for that candidate, and the question goes', async ({ page }) => {
  const { answers } = await open(page)
  // One mark per line with a question, after the line.
  await expect(page.locator('.ingredient-mark')).toHaveCount(2)
  await expect(page.locator('li', { hasText: 'bay leafs' }).getByRole('button', { name: 'Check “bay leafs”' })).toBeVisible()
  const bay = await question(page, 'bay leafs')
  await expect(bay.getByRole('group')).toHaveCount(2)
  await expect(bay.getByRole('button').first()).toBeFocused()
  await page.screenshot({ path: 'test-results/ingredient-bubble.png' })
  await bay.getByRole('group', { name: 'bay laurel' }).getByRole('button', { name: 'Same thing, my name' }).click()
  await expect(mark(page, 'bay leafs')).toHaveCount(0)
  expect(answers).toEqual([{ lineId: 'ingredient_1', answer: 'alias', ingredientId: '8' }])
  await expect(mark(page, 'tomatto')).toBeVisible()
})

test('"Typo" takes the matched name into the recipe on the page', async ({ page }) => {
  const { answers } = await open(page)
  const ingredients = page.getByRole('heading', { name: /Ingredients/ }).locator('xpath=../following-sibling::ul')
  await expect(ingredients).toContainText('tomatto')
  await (await question(page, 'tomatto')).getByRole('button', { name: 'Typo' }).click()
  await expect(mark(page, 'tomatto')).toHaveCount(0)
  expect(answers).toEqual([{ lineId: 'ingredient_2', answer: 'typo', ingredientId: '9' }])
  await expect(ingredients).toContainText('tomato')
  await expect(ingredients).not.toContainText('tomatto')
})

test('"None of these" answers for the line', async ({ page }) => {
  const { answers } = await open(page)
  await (await question(page, 'bay leafs')).getByRole('button', { name: 'None of these' }).click()
  await expect(mark(page, 'bay leafs')).toHaveCount(0)
  expect(answers).toEqual([{ lineId: 'ingredient_1', answer: 'none' }])
})

test('Escape, or clicking elsewhere, closes the bubble', async ({ page }) => {
  await open(page)
  const bubble = await question(page, 'tomatto')
  await page.keyboard.press('Escape')
  await expect(bubble).toHaveCount(0)
  await expect(mark(page, 'tomatto')).toBeFocused()
  await question(page, 'tomatto')
  await page.getByRole('heading', { name: 'Ragù' }).first().click()
  await expect(bubble).toHaveCount(0)
})

test('a question matching finds later appears without a reload', async ({ page }) => {
  // The first read finds nothing; the stream then says the recipe was matched.
  const { asked } = await open(page, { questions: [], later: [tomato] })
  await expect(mark(page, 'tomatto')).toBeVisible()
  expect(asked.length).toBeGreaterThanOrEqual(2)
})
