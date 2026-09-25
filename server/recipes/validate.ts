import type { H3Event } from 'h3'
import { readJsonBody } from '../extraction/body.ts'
import { fail } from '../extraction/errors.ts'
import { isUnit } from '../extraction/quantity.ts'
import { LIMITS, type IngredientDraft, type Quantity, type RecipeDraft, type RecipeSource } from '../extraction/recipe.ts'
import { httpUrl, MAX_URL_LENGTH } from '../extraction/url.ts'

/**
 * A recipe on its way in from a browser.
 *
 * `parseExtraction` cannot be reused for this. It is written for model output
 * and recovers rather than rejects — a clamped title and a dropped ingredient
 * still make a usable recipe, and a model cannot be argued with. A browser
 * can: it is our own code, and a request it got wrong is a bug worth hearing
 * about rather than a row worth keeping. So everything here refuses.
 *
 * What it produces is a draft, not a recipe. Ingredient ids, step parts and
 * the links between them are rebuilt by the same assembly the extraction
 * routes use, so a saved recipe and an extracted one are the same shape by
 * construction and nothing structural arrives from outside.
 */
export type ValidatedDraft = { draft: RecipeDraft, source: RecipeSource }

const object = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail(400, `Expected ${what} to be an object.`)
  return value as Record<string, unknown>
}

const string = (value: unknown, max: number, what: string): string => {
  if (typeof value !== 'string') throw fail(400, `Expected ${what} to be a string.`)
  if (value.length > max) throw fail(413, `${what} is limited to ${max} characters.`)
  return value
}

// Absent and null are the same thing on the way in: a field a source never had
// is not distinguishable from one the browser dropped, and both mean nothing
// to store.
const optional = <T>(value: unknown, read: () => T): T | null =>
  value === undefined || value === null ? null : read()

const positive = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw fail(400, `Expected ${what} to be a number.`)
  if (value <= 0) throw fail(400, `${what} must be greater than zero.`)
  return value
}

const array = (value: unknown, max: number, what: string): unknown[] => {
  if (!Array.isArray(value)) throw fail(400, `Expected ${what} to be an array.`)
  // Sliced silently for model output; refused here, because a client sending
  // 300 ingredients is not a recipe that needs trimming.
  if (value.length > max) throw fail(413, `A recipe is limited to ${max} ${what}.`)
  return value
}

// An amount the client claims to have read into numbers — its own, or one it
// is handing back unchanged. Unusable parts become null rather than an error:
// normalizeRecipe reads the text instead, which is what happens for every
// ingredient the model extracted.
const quantityOf = (value: unknown): Quantity | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { value: amount, maxValue, unit } = value as Partial<Quantity>
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  return {
    value: amount,
    maxValue: typeof maxValue === 'number' && Number.isFinite(maxValue) && maxValue > amount ? maxValue : null,
    unit: isUnit(unit) ? unit : null,
  }
}

const ingredientOf = (value: unknown, index: number): IngredientDraft => {
  const item = object(value, `ingredient ${index + 1}`)
  const originalText = string(item.originalText, LIMITS.ingredient, `ingredient ${index + 1}`)
  if (!originalText.trim()) throw fail(400, `Ingredient ${index + 1} is empty.`)
  // `quantity` is the segmented text on a draft and the read amount on a
  // normalized recipe, and both shapes arrive here — an extraction handed back
  // unchanged, or one a person edited. Whichever it is, it is taken for what
  // it looks like rather than for where it sits.
  const amountText = typeof item.quantityText === 'string' ? item.quantityText
    : typeof item.quantity === 'string' ? item.quantity
      : null
  const amount = typeof item.quantity === 'object' ? item.quantity : item.parsedQuantity
  return {
    originalText,
    name: optional(item.name, () => string(item.name, LIMITS.ingredient, `ingredient ${index + 1} name`)) ?? originalText,
    quantity: optional(amountText, () => string(amountText, LIMITS.quantity, `ingredient ${index + 1} amount`)),
    extra: optional(item.extra, () => string(item.extra, LIMITS.extra, `ingredient ${index + 1} note`)),
    // The client may hand back the amount already in numbers, including one a
    // person corrected. Anything unreadable falls through to the parser.
    parsedQuantity: quantityOf(amount),
  }
}

// Where a recipe came from is not the client's to invent: it is echoed back
// from an extraction, it lands in a JSONB column, and #22 and object storage
// will both read it. Each variant is checked field by field.
const sourceOf = (value: unknown): RecipeSource => {
  const source = object(value, '"source"')
  switch (source.type) {
    case 'text':
      return { type: 'text', originalText: string(source.originalText, LIMITS.step, 'the source text') }
    case 'website': {
      const url = httpUrl(source.url)
      if (!url) throw fail(400, 'A website source needs an http or https URL.')
      const retrievedAt = string(source.retrievedAt, 40, '"retrievedAt"')
      if (Number.isNaN(Date.parse(retrievedAt))) throw fail(400, '"retrievedAt" must be a date.')
      return {
        type: 'website',
        url,
        author: optional(source.author, () => string(source.author, LIMITS.title, 'the author')),
        siteName: optional(source.siteName, () => string(source.siteName, LIMITS.title, 'the site name')),
        retrievedAt,
      }
    }
    case 'photo':
      return {
        type: 'photo',
        // Null until object storage lands. A client cannot name a key that
        // does not exist yet, so one it sends is not believed.
        objectKey: null,
        originalFilename: optional(source.originalFilename, () => string(source.originalFilename, LIMITS.title, 'the filename')),
      }
    default:
      throw fail(400, 'A recipe source must be text, website or photo.')
  }
}

export function validateRecipe(body: unknown): ValidatedDraft {
  const value = object(body, 'a recipe')
  const recipe = object(value.recipe ?? value, 'a recipe')

  const ingredients = array(recipe.ingredients, LIMITS.ingredients, 'ingredients').map(ingredientOf)
  const steps = array(recipe.steps, LIMITS.steps, 'steps').map((step, index) => {
    // Steps arrive as the text they are made of. Their parts and the
    // measurements inside them are derived again on this side, so a client
    // cannot point a step at an ingredient that is not there.
    const text = typeof step === 'string' ? step : string(object(step, `step ${index + 1}`).originalText, LIMITS.step, `step ${index + 1}`)
    return string(text, LIMITS.step, `step ${index + 1}`)
  }).filter(step => step.trim() !== '')

  // The one thing extraction itself refuses: well-formed and empty is not a
  // recipe. A title alone is not worth a row.
  if (!ingredients.length && !steps.length) throw fail(422, 'A recipe needs at least one ingredient or step.')

  return {
    draft: {
      title: optional(recipe.title, () => string(recipe.title, LIMITS.title, 'the title')),
      source_lang: optional(recipe.source_lang, () => string(recipe.source_lang, 35, '"source_lang"')) ?? 'und',
      portions: optional(recipe.portions, () => positive(recipe.portions, 'portions')),
      // Checked rather than trusted: it is a URL the page chose, arriving here
      // by way of a browser.
      image: optional(recipe.image, () => {
        const image = httpUrl(string(recipe.image, MAX_URL_LENGTH, 'the image URL'))
        if (!image) throw fail(400, 'The image must be an http or https URL.')
        return image
      }),
      totalTime: optional(recipe.totalTime, () => {
        const minutes = positive(recipe.totalTime, 'the total time')
        if (minutes > LIMITS.totalTime) throw fail(400, 'The total time is longer than a month.')
        return Math.round(minutes)
      }),
      ingredients,
      steps,
    },
    source: sourceOf(recipe.source),
  }
}

export async function readRecipeBody(event: H3Event): Promise<ValidatedDraft> {
  return validateRecipe(await readJsonBody(event))
}
