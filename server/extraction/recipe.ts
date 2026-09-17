import { fail } from './errors.ts'
import { isUnit } from './quantity.ts'
import { httpUrl } from './url.ts'

// Storage limits. A generation grammar cannot express them, so they are
// applied here, on the way from model output to stored document.
// totalTime is in minutes, capped at a month: a cured ham is days, nothing is
// longer, and a site that says otherwise is reporting something else.
const LIMITS = { title: 300, ingredient: 2000, quantity: 100, extra: 500, ingredients: 200, step: 5000, steps: 100, totalTime: 60 * 24 * 30 }

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
  // ingredient is prepared, an aside, what it is for. Also fetcher-only.
  extra?: string | null
}

export type RecipeDraft = {
  title: string | null
  source_lang: string
  portions: number | null
  ingredients: IngredientDraft[]
  steps: string[]
  // A page carries these; a paste and a photo do not, and the model is not
  // asked to invent them.
  image?: string | null
  totalTime?: number | null
}

export type Unit =
  | 'g' | 'kg' | 'mg' | 'oz' | 'lb'
  | 'ml' | 'l' | 'cup_us' | 'cup_metric' | 'tbsp_us' | 'tbsp_metric' | 'tbsp_au'
  | 'tsp_us' | 'tsp_metric' | 'fl_oz_us' | 'fl_oz_imperial'
  | 'celsius' | 'fahrenheit'
  | 'second' | 'minute' | 'hour'
  | 'mm' | 'cm' | 'inch'
  | 'count'
  // Regionally ambiguous as written; resolved for display, not at extraction.
  | 'cup' | 'tbsp' | 'tsp' | 'fl_oz'

export type QuantityKind = 'mass' | 'volume' | 'count' | 'temperature' | 'duration' | 'length' | 'other'

export type Quantity = { value: number, maxValue: number | null, unit: Unit | null }

export type Ingredient = {
  id: string
  originalText: string
  name: string
  // The model's segmentation, kept so the parser can be rerun without it.
  quantityText: string | null
  quantity: Quantity | null
  // "finely diced", "for the sauce" — the rest of the line, for display
  // beside the name. Null where the source segmented nothing out.
  extra: string | null
}

export type StepPart =
  | { type: 'text', value: string }
  // Keys into the step's own quantities.
  | { type: 'measurement', quantity: string }
  // Points at an ingredient whose full amount this step restates.
  | { type: 'ingredientQuantity', ingredientId: string }

export type StepQuantity = Quantity & { kind: QuantityKind, scaleWithPortions: boolean | null }

export type Step = {
  id: string
  originalText: string
  parts: StepPart[]
  quantities: Record<string, StepQuantity>
}

// Only the modality that ran the extraction knows where it came from, so each
// one builds this itself and hands it to parseExtraction.
export type RecipeSource =
  | { type: 'text', originalText: string }
  | { type: 'website', url: string, author: string | null, siteName: string | null, retrievedAt: string }
  | { type: 'photo', objectKey: string, originalFilename: string | null }

export type ExtractedRecipe = {
  title: string | null
  source_lang: string
  portions: number | null
  // A picture of the dish, and how long it takes end to end. Both come from a
  // page's own metadata; null for every other source, for now.
  image: string | null
  totalTime: number | null
  ingredients: Ingredient[]
  steps: Step[]
  source: RecipeSource
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
  text: { service: 'Ollama', where: 'in that text' },
  website: { service: 'The recipe fetcher', where: 'on that page' },
  photo: { service: 'Ollama', where: 'in that photo' },
}

export function parseExtraction(value: unknown, source: RecipeSource): ExtractedRecipe {
  const origin = ORIGIN[source.type]
  // For the model these are unreachable while the grammar is applied: reaching
  // them means `format` was ignored, and then nothing below can be trusted.
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
