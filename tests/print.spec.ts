import { test, expect, type Page } from '@playwright/test'

// Printing a recipe (#135), against a mocked API. What the page looks like on
// paper is in the PDFs this leaves in test-results; this checks that it is the
// recipe as read, without the app around it, and on how many pages.
const id = '11111111-1111-4111-8111-111111111111'
const text = (value: string) => ({ type: 'text', value })
const ingredient = (n: number, name: string, value: number, unit: string | null) => ({
  id: `ingredient_${n}`, originalText: `${value} ${unit ?? ''} ${name}`, name, quantityText: `${value}${unit ? ` ${unit}` : ''}`,
  quantity: { value, maxValue: null, unit }, extra: null,
})
const step = (n: number, value: string) => ({ id: `step_${n}`, originalText: value, parts: [text(value)], quantities: {} })
const recipe = {
  id, title: 'Weeknight lasagne', image: null, totalTime: 90, portions: 4, source_lang: 'en',
  ingredients: [
    ingredient(1, 'minced beef', 500, 'g'), ingredient(2, 'onions', 2, null), ingredient(3, 'garlic cloves', 3, null),
    ingredient(4, 'chopped tomatoes', 800, 'g'), ingredient(5, 'tomato purée', 2, 'tbsp'), ingredient(6, 'butter', 50, 'g'),
    ingredient(7, 'flour', 50, 'g'), ingredient(8, 'milk', 600, 'ml'), ingredient(9, 'lasagne sheets', 250, 'g'),
    ingredient(10, 'parmesan', 60, 'g'), ingredient(11, 'nutmeg', 1, null), ingredient(12, 'olive oil', 2, 'tbsp'),
  ],
  steps: [
    'Chop the onions and garlic finely and soften them in the olive oil over a medium heat for about ten minutes.',
    'Add the beef and brown it all over, breaking it up with a wooden spoon as it cooks.',
    'Stir in the tomatoes and the purée, season well, and simmer gently for thirty minutes until thick.',
    'Melt the butter, stir in the flour and cook for a minute, then whisk in the milk a little at a time.',
    'Simmer the sauce until it coats the back of a spoon; season it with salt and the nutmeg.',
    'Heat the oven to 190 °C. Layer meat sauce, sheets and white sauce in a dish, three times over.',
    'Finish with white sauce and the parmesan, and bake for forty minutes until golden and bubbling.',
    'Rest it for ten minutes before cutting, so the layers hold.',
  ].map((value, index) => step(index + 1, value)),
  source: { type: 'text', originalText: '' },
  tags: ['pasta'], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

async function open(page: Page) {
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...recipe, ingredientCount: 12, stepCount: 8 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe } }))
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
}

// Chromium writes one page object per printed page.
const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0

test('Print is offered while reading, and prints the recipe as read', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).printed = 0; window.print = () => { (window as any).printed++ } })
  const print = page.getByRole('button', { name: 'Print' })
  await print.click()
  expect(await page.evaluate(() => (window as any).printed)).toBe(1)

  await page.getByRole('switch', { name: 'Edit recipe' }).click()
  await expect(print).toHaveCount(0)
  await page.getByRole('switch', { name: 'Edit recipe' }).click()

  // Scaled, so the paper says what the screen says.
  await page.getByRole('button', { name: 'More servings' }).click()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.portion-count')).toHaveText('Serves 5')
  await expect(page.locator('.detail-content ul li').first()).toContainText('625 g minced beef')
  for (const chrome of ['.header', 'footer', '.collection-list', '.title-controls', '.recipe-actions', '.tag-editor', '.similar-recipes'])
    await expect(page.locator(chrome).first()).toBeHidden()
  await expect(page.getByRole('button', { name: 'More servings' })).toBeHidden()
  await expect(page.locator('.step-list li')).toHaveCount(8)

  const a4 = await page.pdf({ format: 'A4', path: 'test-results/print-a4.pdf' })
  expect(pages(a4)).toBe(1)
  const a6 = await page.pdf({ format: 'A6', path: 'test-results/print-a6.pdf' })
  expect(pages(a6)).toBeGreaterThan(1)
})
