import { kindOf, measurementPattern, parseQuantity } from './quantity.ts'
import type { ExtractedRecipe, Ingredient, Quantity, QuantityKind, Step, StepPart, StepQuantity } from './recipe.ts'

// Oven temperatures and timings stay put when portions change; amounts do not.
const SCALES: Record<QuantityKind, boolean | null> = {
  mass: true,
  volume: true,
  count: true,
  temperature: false,
  duration: false,
  length: false,
  other: null,
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sameQuantity = (a: Quantity, b: Quantity) =>
  a.value === b.value && a.maxValue === b.maxValue && a.unit === b.unit

/**
 * Where an ingredient is named in a step, or -1. Falls back to the head noun,
 * so "ground cinnamon" still matches a step that says only "cinnamon", and
 * tolerates a plural on either side.
 */
function mentionIndex(text: string, name: string): number {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return -1
  const terms = words.length > 1 ? [name, words[words.length - 1]!] : [name]
  for (const term of terms) {
    const base = term.length > 3 ? term.replace(/s$/i, '') : term
    const found = new RegExp(`\\b${escape(base)}s?\\b`, 'i').exec(text)
    if (found) return found.index
  }
  return -1
}

/**
 * A step that restates an ingredient's full amount should point at the
 * ingredient rather than carry its own copy, so rescaling the recipe moves
 * both together. The amount has to match exactly: "1 cup of the milk" drawn
 * from "2 cups milk" is a portion of it, not a restatement.
 */
function linkedIngredient(
  text: string,
  after: number,
  quantity: Quantity,
  ingredients: Ingredient[],
): Ingredient | null {
  let best: Ingredient | null = null
  let bestDistance = Infinity
  for (const ingredient of ingredients) {
    if (!ingredient.quantity || !sameQuantity(ingredient.quantity, quantity)) continue
    const index = mentionIndex(text, ingredient.name)
    if (index < 0) continue
    // "2 cups flour" names the ingredient after the amount, so prefer that;
    // a mention before it still counts, just less strongly.
    const distance = index >= after ? index - after : after - index + text.length
    if (distance < bestDistance) {
      best = ingredient
      bestDistance = distance
    }
  }
  return best
}

function normalizeStep(step: Step, ingredients: Ingredient[]): Step {
  const text = step.originalText
  const parts: StepPart[] = []
  const quantities: Record<string, StepQuantity> = {}
  const counters = new Map<QuantityKind, number>()
  let cursor = 0

  for (const match of text.matchAll(measurementPattern())) {
    const measurement = match[0]
    const quantity = parseQuantity(measurement)
    // A bare number ("beat 2 eggs") is not a measurement, and an unrecognised
    // word leaves the unit null. Both stay plain text.
    if (!quantity?.unit || quantity.unit === 'count') continue

    const start = match.index ?? 0
    const before = text.slice(cursor, start)
    if (before) parts.push({ type: 'text', value: before })

    const ingredient = linkedIngredient(text, start + measurement.length, quantity, ingredients)
    if (ingredient) {
      parts.push({ type: 'ingredientQuantity', ingredientId: ingredient.id })
    } else {
      const kind = kindOf(quantity.unit)
      const index = (counters.get(kind) ?? 0) + 1
      counters.set(kind, index)
      const id = `${kind}_${index}`
      parts.push({ type: 'measurement', quantity: id })
      quantities[id] = { ...quantity, kind, scaleWithPortions: SCALES[kind] }
    }
    cursor = start + measurement.length
  }

  const tail = text.slice(cursor)
  if (tail) parts.push({ type: 'text', value: tail })
  // A step with no recognised measurement keeps its single text part.
  return { ...step, parts: parts.length ? parts : [{ type: 'text', value: text }], quantities }
}

/**
 * Third pipeline step, after the model has answered and parseExtraction has
 * validated it: reads the segmented quantities into numbers and units, finds
 * the measurements inside each step, and points the ones that restate an
 * ingredient back at it.
 *
 * Every reference it emits points at an ID it created itself, which is why
 * this runs here rather than being asked of the model.
 */
export function normalizeRecipe(recipe: ExtractedRecipe): ExtractedRecipe {
  const ingredients = recipe.ingredients.map(ingredient => ({
    ...ingredient,
    // A source that read the amount itself keeps its reading; everything else
    // is read out of the segmented text here.
    quantity: ingredient.quantity ?? parseQuantity(ingredient.quantityText),
  }))
  return {
    ...recipe,
    ingredients,
    steps: recipe.steps.map(step => normalizeStep(step, ingredients)),
  }
}
