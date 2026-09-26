import { fail } from './errors.ts'
import { isUnit } from './quantity.ts'
import { httpUrl } from './url.ts'
import type { ExtractedRecipe, Ingredient, Quantity, RecipeSource } from '../../shared/types/recipe.ts'

// The recipe types are shared with the app, so they live in shared/; this file
// keeps the rules that build them, and re-exports them for the server's sake.
export type { ExtractedRecipe, Ingredient, Quantity, QuantityKind, RecipeSource, Step, StepPart, StepQuantity, Unit } from '../../shared/types/recipe.ts'

// Storage limits. The response schema cannot express them, so they are
// applied here, on the way from model output to stored document.
// totalTime is in minutes, capped at a month: a cured ham is days, nothing is
// longer, and a site that says otherwise is reporting something else.
export const LIMITS = { title: 300, ingredient: 2000, quantity: 100, extra: 500, ingredients: 200, step: 5000, steps: 100, totalTime: 60 * 24 * 30 }

// What the model is asked for. Untrusted until parseExtraction has run.
export type IngredientDraft = {
  originalText: string
  quantity: string | null
  name: string
  // Only a source that parses amounts itself sends this — the fetcher service
  // does, the model is never asked for it. Absent, normalizeRecipe reads the
  // quantity out of the text instead.
  parsedQuantity?: Quantity | null
  // What is left of the line once the amount and the name are out: how the
  // ingredient is prepared, an aside, what it is for. The fetcher segments it
  // out, and the model is asked for it too.
  extra?: string | null
}

export type RecipeDraft = {
  title: string | null
  source_lang: string
  portions: number | null
  ingredients: IngredientDraft[]
  steps: string[]
  // Optional because not every source states them. A page carries both in its
  // metadata; the model is asked for totalTime and never for an image, which
  // it has no way to know.
  image?: string | null
  totalTime?: number | null
}

const clamp = (value: string, max: number) => value.length > max ? value.slice(0, max) : value

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? clamp(value, max) : null

// Minutes, rounded and capped. A site reporting a negative or absurd total is
// reporting something that is not a duration.
const minutes = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), LIMITS.totalTime)
    : null

const lines = (value: unknown[], maxItems: number, maxLength: number) => value
  .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  .slice(0, maxItems)
  .map(item => clamp(item, maxLength))

/**
 * An amount a source claims to have already read into numbers. It arrives over
 * HTTP like everything else here, so each field is checked rather than trusted,
 * and anything unusable becomes null — leaving normalizeRecipe to read the
 * text, which is what happens for every ingredient the model extracted.
 */
const parsedQuantityOf = (value: unknown): Quantity | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { value: amount, maxValue, unit } = value as Partial<Quantity>
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  return {
    value: amount,
    // A range that does not climb is not a range, and one that looks like it
    // would stop this amount matching the same amount stated in a step.
    maxValue: typeof maxValue === 'number' && Number.isFinite(maxValue) && maxValue > amount ? maxValue : null,
    // An unrecognised unit is reported as no unit, exactly as parseQuantity
    // does with wording it cannot place.
    unit: isUnit(unit) ? unit : null,
  }
}

const ingredientsOf = (value: unknown[]): Ingredient[] => value
  .filter((item): item is Partial<IngredientDraft> =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
    && text((item as IngredientDraft).originalText, LIMITS.ingredient) !== null)
  .slice(0, LIMITS.ingredients)
  .map((item, index) => {
    const originalText = clamp((item.originalText as string).trim(), LIMITS.ingredient)
    return {
      id: `ingredient_${index + 1}`,
      originalText,
      // A model that segments nothing out still leaves a displayable line.
      name: text(item.name, LIMITS.ingredient) ?? originalText,
      quantityText: text(item.quantity, LIMITS.quantity),
      extra: text(item.extra, LIMITS.extra),
      // Already read into numbers by the source, or filled by normalizeRecipe,
      // the step after this one.
      quantity: parsedQuantityOf(item.parsedQuantity),
    }
  })

// A failure should name what actually failed, and each modality answers to
// something different. Only the wording changes; what is checked does not.
const ORIGIN: Record<RecipeSource['type'], { service: string, where: string }> = {
  text: { service: 'The extraction service', where: 'in that text' },
  website: { service: 'The recipe fetcher', where: 'on that page' },
  photo: { service: 'The extraction service', where: 'in that photo' },
}

export function parseExtraction(value: unknown, source: RecipeSource): ExtractedRecipe {
  const origin = ORIGIN[source.type]
  // For the model these are unreachable while the response schema holds:
  // reaching them means the schema was ignored, and then nothing below can be
  // trusted.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw fail(502, `${origin.service} did not return a recipe object.`, value)
  }
  const draft = value as Partial<RecipeDraft>
  if (!Array.isArray(draft.ingredients) || !Array.isArray(draft.steps)) {
    throw fail(502, `${origin.service} returned a recipe without ingredient and step lists.`, draft)
  }

  // IDs are assigned after filtering and slicing, so they stay dense and the
  // step schema's references cannot point at a dropped line.
  const ingredients = ingredientsOf(draft.ingredients)
  const steps = lines(draft.steps, LIMITS.steps, LIMITS.step)
  // Well-formed but empty: the source was probably not a recipe at all.
  if (!ingredients.length && !steps.length) {
    throw fail(422, `No recipe could be found ${origin.where}.`)
  }

  return {
    // Everything below recovers rather than rejects: a clamped field still
    // makes a usable recipe, and the model cannot be argued with.
    title: text(draft.title, LIMITS.title),
    source_lang: text(draft.source_lang, 35) ?? 'und',
    portions: typeof draft.portions === 'number' && Number.isFinite(draft.portions) && draft.portions > 0 ? draft.portions : null,
    // A page chose this URL, so it is checked before it is kept.
    image: httpUrl(draft.image),
    totalTime: minutes(draft.totalTime),
    ingredients,
    steps: steps.map((originalText, index) => ({
      id: `step_${index + 1}`,
      originalText,
      // Replaced by normalizeRecipe once the measurements are located.
      parts: [{ type: 'text', value: originalText }],
      quantities: {},
    })),
    source,
  }
}
