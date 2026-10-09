import { test, expect } from '@playwright/test'

// Prefix links and the bookmarklet (#136), signed out: /get/<url> hands the
// address to the import dialog over the shelf, and nothing is fetched. The
// signed-in half, where the address is sent, is in tests/auth/oidc.spec.ts.
const DRAFT = 'recipeat-import-draft'

async function draftAfterSignIn(page: import('@playwright/test').Page) {
  // A stand-in for the provider, on this origin, so the draft can be read.
  await page.route('**/auth/zitadel/login**', route => route.fulfill({ contentType: 'text/html', body: 'signing in' }))
  await page.getByRole('button', { name: 'Sign in to continue' }).click()
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), DRAFT)).not.toBeNull()
  return JSON.parse((await page.evaluate(key => sessionStorage.getItem(key), DRAFT))!)
}

test('a prefix link opens the import over the shelf, and keeps the address through a sign-in', async ({ page }) => {
  let extractions = 0
  await page.route('**/api/extract/**', route => { extractions++; return route.abort() })
  await page.goto('/get/https://itsnotaboutnutrition.com/teriyaki/?print=1&servings=4#recipe')
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(page.getByRole('dialog')).toContainText('Sign in, and you can bring recipes in')
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0)
  expect(await draftAfterSignIn(page)).toEqual({ mode: 'website', input: 'https://itsnotaboutnutrition.com/teriyaki/?print=1&servings=4#recipe' })
  expect(extractions).toBe(0)
})

test('a scheme folded to one slash is put back', async ({ page }) => {
  await page.goto('/get/https:/example.com/pancakes')
  await expect(page).toHaveURL(/\/recipes$/)
  expect(await draftAfterSignIn(page)).toEqual({ mode: 'website', input: 'https://example.com/pancakes' })
})

test('a link that is not http(s) opens the dialog empty, saying why', async ({ page }) => {
  await page.goto('/get/ftp://example.com/pancakes')
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('only http and https web addresses')
  expect(await draftAfterSignIn(page)).toEqual({ mode: 'website', input: '' })
})

test('/get/ with nothing after it opens the dialog empty', async ({ page }) => {
  await page.goto('/get/')
  await expect(page).toHaveURL(/\/recipes$/)
  await expect(page.getByRole('dialog')).toContainText('Sign in, and you can bring recipes in')
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0)
})
