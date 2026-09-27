import { test, expect, type Page, type Route } from '@playwright/test'

// The editor against a mocked API. As in collection.spec.ts, every test
// arrives by clicking through from the landing page, so the mocks see every
// request. What the server makes of a save is its own tests' business; here
// the answer is written by hand, and the test checks what was sent and what
// the page does with the answer.
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const summary = (id: string, title: string) => ({
  id, title, image: null, totalTime: 30, portions: 2, ingredientCount: 2, stepCount: 3,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})
const text = (value: string) => ({ type: 'text', value })
const focaccia = () => ({
  ...summary(ids[0], 'Focaccia'),
  source_lang: 'en',
  ingredients: [
    { id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null },
    { id: 'ingredient_2', originalText: '1 tsp salt, fine', name: 'salt', quantityText: '1 tsp', quantity: { value: 1, maxValue: null, unit: 'tsp' }, extra: 'fine' },
  ],
  steps: [
    { id: 'step_1', originalText: 'Dough: mix everything.', parts: [text('Dough: mix everything.')], quantities: {} },
    { id: 'step_2', originalText: '1. Add 500 g flour.', parts: [text('1. Add '), { type: 'ingredientQuantity', ingredientId: 'ingredient_1' }, text(' flour.')], quantities: {} },
    { id: 'step_3', originalText: '2. Bake.', parts: [text('2. Bake.')], quantities: {} },
  ],
  source: { type: 'text', originalText: '' },
  lineId: ids[0], progressionOf: null, variantOf: null, pinned: true,
})
const other = () => ({ ...focaccia(), ...summary(ids[1], 'Ragù'), lineId: ids[1] })

type Saved = ReturnType<typeof focaccia>
async function mockApi(page: Page, onSave?: (body: any, route: Route) => Promise<void> | void) {
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [summary(ids[0], 'Focaccia'), summary(ids[1], 'Ragù')] } }))
  await page.route('**/api/recipes/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    if (route.request().method() === 'PUT') return onSave?.(route.request().postDataJSON(), route)
    return route.fulfill({ json: { recipe: id === ids[0] ? focaccia() : other() } })
  })
}

// A recipe opens to be read; editing is one switch away.
const openFocaccia = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My collection/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${ids[0]}`)
  await expect(page.locator('.collection-pane')).toContainText('500 g')
  await expect(page.getByRole('button', { name: /^Edit title/ })).toHaveCount(0)
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await expect(page.getByRole('switch', { name: 'Edit recipe' })).toHaveAttribute('aria-checked', 'true')
}

const bar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' })
// These save over the recipe: the PUT is what they mock. The other two ways to
// save are tests/writes.spec.ts.
const overwrite = async (page: Page) => {
  await bar(page).getByRole('radio', { name: /Overwrite this version/ }).check()
  await bar(page).getByRole('button', { name: 'Overwrite' }).click()
}

test('a field is typed into where it stands, and Save writes the edit and renders the answer', async ({ page }) => {
  let sent: any
  await mockApi(page, (body, route) => {
    sent = body
    // What the server would make of it: the amount read again, and the step
    // that restates it still pointing at the ingredient.
    const saved: Saved = focaccia()
    saved.title = body.recipe.title
    saved.ingredients[0] = { ...saved.ingredients[0]!, originalText: '600 g flour', quantityText: '600 g', quantity: { value: 600, maxValue: null, unit: 'g' } }
    saved.updatedAt = '2026-09-02T00:00:00.000Z'
    return route.fulfill({ json: { recipe: saved } })
  })
  await openFocaccia(page)
  await expect(bar(page)).toHaveCount(0)

  // Reading and typing take the same room: nothing below the title moves.
  const heading = page.getByRole('heading', { name: 'Ingredients' })
  const before = await heading.boundingBox()
  await page.getByRole('button', { name: 'Edit title: Focaccia' }).click()
  const title = page.getByRole('textbox', { name: 'title' })
  await expect(title).toBeFocused()
  expect((await heading.boundingBox())!.y).toBeCloseTo(before!.y, 0)
  await expect(title).toHaveAttribute('maxlength', '300')
  await title.fill('Focaccia al rosmarino')
  await title.press('Tab')

  await page.getByRole('button', { name: /^Edit ingredient 1:/ }).click()
  const amount = page.getByRole('textbox', { name: 'Amount' })
  await amount.fill('600 g')
  await amount.press('Enter')
  // Typed, not yet read: shown as written until the save comes back.
  await expect(page.locator('.edit-list li').first()).toContainText('600 g flour')
  await expect(bar(page)).toContainText('Unsaved changes')
  await page.screenshot({ path: 'test-results/editor-unsaved.png', fullPage: true })

  await overwrite(page)
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Saved')
  // The step restating the amount follows the ingredient, from the answer.
  await expect(page.locator('.step-list li').nth(1)).toContainText('Add 600 g flour.')
  await expect(page.locator('.collection-entry').first()).toContainText('Focaccia al rosmarino')

  expect(sent.recipe.title).toBe('Focaccia al rosmarino')
  // An edited line goes as text for the server to read; an untouched one as it came.
  expect(sent.recipe.ingredients[0]).toEqual({ originalText: '600 g flour', name: 'flour', quantityText: '600 g', extra: null })
  expect(sent.recipe.ingredients[1]).toEqual({ originalText: '1 tsp salt, fine', name: 'salt', quantityText: '1 tsp', quantity: { value: 1, maxValue: null, unit: 'tsp' }, extra: 'fine' })
  expect(sent.recipe.steps).toEqual(['Dough: mix everything.', '1. Add 500 g flour.', '2. Bake.'])
})

test('a refused save says why and keeps the edit', async ({ page }) => {
  await mockApi(page, (_body, route) => route.fulfill({ status: 413, json: { message: 'A step is limited to 5000 characters.' } }))
  await openFocaccia(page)
  await page.getByRole('button', { name: 'Edit title: Focaccia' }).click()
  await page.getByRole('textbox', { name: 'title' }).fill('Focaccia two')
  await overwrite(page)
  await expect(bar(page).getByRole('alert')).toContainText('A step is limited to 5000 characters.')
  await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('Focaccia two')
  await bar(page).getByRole('button', { name: 'Discard' }).click()
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator('.collection-pane')).toContainText('Focaccia')
})

test('what cannot be saved is said before it is sent', async ({ page }) => {
  let saves = 0
  await mockApi(page, () => { saves++ })
  await openFocaccia(page)
  await page.getByRole('button', { name: /^Edit total time/ }).click()
  await page.getByRole('textbox', { name: 'total time' }).fill('a while')
  await page.keyboard.press('Enter')
  await expect(bar(page)).toContainText('isn’t a duration')
  await expect(bar(page).getByRole('button', { name: 'Save as new version' })).toBeDisabled()
  expect(saves).toBe(0)
})

test('ingredients and steps are added, moved and removed, and the steps are counted once moved', async ({ page }) => {
  let sent: any
  await mockApi(page, (body, route) => { sent = body; return route.fulfill({ json: { recipe: focaccia() } }) })
  await openFocaccia(page)

  await page.getByRole('button', { name: 'Add ingredient' }).click()
  // A line just added opens for typing, at its amount.
  await expect(page.getByRole('textbox', { name: 'Amount' })).toBeFocused()
  await page.keyboard.type('2 tbsp')
  await page.keyboard.press('Tab')
  await page.keyboard.type('olive oil')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Remove ingredient 2' }).click()
  await expect(page.locator('.edit-list').first().locator('li')).toHaveCount(2)

  await page.getByRole('button', { name: 'Move step 3 up' }).click()
  await page.getByRole('button', { name: 'Add step' }).click()
  await expect(page.getByRole('textbox', { name: 'step 4' })).toBeFocused()
  await page.keyboard.type('Serve warm.')
  await page.keyboard.press('Tab')
  // Out of the source's order, its numbers no longer apply: counted from one.
  await expect(page.locator('.step-list .step-mark')).toHaveText(['1.', '2.', '3.', '4.'])

  await overwrite(page)
  await expect(bar(page)).toHaveCount(0)
  expect(sent.recipe.ingredients.map((ingredient: { originalText: string }) => ingredient.originalText)).toEqual(['500 g flour', '2 tbsp olive oil'])
  expect(sent.recipe.steps).toEqual(['Dough: mix everything.', 'Bake.', 'Add 500 g flour.', 'Serve warm.'])
})

test('leaving with unsaved changes asks first', async ({ page }) => {
  await mockApi(page)
  await openFocaccia(page)
  await page.getByRole('button', { name: 'Edit title: Focaccia' }).click()
  await page.getByRole('textbox', { name: 'title' }).fill('Focaccia, unsaved')
  await page.locator('.collection-entry').nth(1).click()
  const question = page.getByRole('dialog', { name: 'Leave without saving?' })
  await expect(question).toBeVisible()
  await expect(question.getByRole('button', { name: 'Save and leave' })).toBeFocused()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page).toHaveURL(`/recipes/${ids[0]}`)
  await expect(bar(page)).toBeVisible()

  await page.locator('.collection-entry').nth(1).click()
  await question.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(`/recipes/${ids[1]}`)
  await expect(page.locator('.collection-pane')).toContainText('Ragù')
})

test('a fresh import is edited before it is first added', async ({ page }) => {
  // An import waiting out a sign-in comes back as it was: the one way into the
  // dialog with a fresh recipe that needs no extraction route.
  const fresh = { ...focaccia(), title: 'Imported bread' } as Record<string, unknown>
  for (const key of ['id', 'lineId', 'progressionOf', 'variantOf', 'pinned', 'createdAt', 'updatedAt', 'ingredientCount', 'stepCount']) delete fresh[key]
  await page.addInitScript(recipe => sessionStorage.setItem('recipeat-unsaved-recipe', recipe), JSON.stringify(fresh))
  let sent: any
  await page.route('**/api/recipes', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { recipes: [] } })
    sent = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: { recipe: { ...focaccia(), title: sent.recipe.title } } })
  })
  await page.goto('/')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Imported bread')
  await dialog.getByRole('button', { name: 'Edit title: Imported bread' }).click()
  await dialog.getByRole('textbox', { name: 'title' }).fill('Grandma’s bread')
  // Escape puts the field away without closing the dialog around it.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Add to my collection' }).click()
  await expect(dialog.getByText('In your collection')).toBeVisible()
  expect(sent.recipe.title).toBe('Grandma’s bread')
  // Once stored, it is edited on its own page, not here.
  await expect(dialog.getByRole('button', { name: /^Edit title/ })).toHaveCount(0)
})

test('on a phone the controls are always there and an open line still fits', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await mockApi(page)
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('link', { name: /My collection/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${ids[0]}`)
  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  // No hover to reveal them: they are shown.
  await expect(page.getByRole('button', { name: 'Remove ingredient 1' })).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: /^Edit ingredient 2:/ }).tap()
  // Open at whichever part was tapped.
  await expect(page.locator('.ingredient-inputs input:focus')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/editor-phone.png' })
  await context.close()
})
