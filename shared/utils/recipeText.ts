import type { ExtractedRecipe, Ingredient, Quantity, Step, StepPart, Unit } from '../types/recipe.ts'
import { kitchen, metric, scaleQuantity, stepScaling, UNSCALED, type Scale } from './recipeScale.ts'

// How a stored recipe's structure reads as text: amounts from their parsed
// quantities, steps from their parts, in the unit system the reader chose.
// Kept apart from the components so the rules can be tested without a
// browser, and so #44 rescales the same numbers this prints.

// ── Regional units ─────────────────────────────────────────────────────────

type Region = 'us' | 'metric' | 'au'

// A cup, a spoon and a fluid ounce are different sizes in different places,
// and the line itself never says which. The recipe's language is the best
// guess there is: American English is US measures, Australian English has its
// own 20 ml tablespoon, and everywhere else is metric. A bare "en" is most
// often an American page.
export function unitRegion(lang: string): Region {
  const [language, region] = lang.toLowerCase().split(/[-_]/)
  if (language !== 'en') return 'metric'
  if (!region || region === 'us') return 'us'
  if (region === 'au') return 'au'
  return 'metric'
}

const REGIONAL: Partial<Record<Unit, Record<Region, Unit>>> = {
  cup: { us: 'cup_us', metric: 'cup_metric', au: 'cup_metric' },
  tbsp: { us: 'tbsp_us', metric: 'tbsp_metric', au: 'tbsp_au' },
  tsp: { us: 'tsp_us', metric: 'tsp_metric', au: 'tsp_metric' },
  fl_oz: { us: 'fl_oz_us', metric: 'fl_oz_imperial', au: 'fl_oz_imperial' },
}

/** The regional unit an ambiguous one means in this recipe; any other unit as it is. */
export const resolveUnit = (unit: Unit, lang: string): Unit => REGIONAL[unit]?.[unitRegion(lang)] ?? unit

// ── Unit systems ───────────────────────────────────────────────────────────

export type UnitSystem = 'imperial' | 'metric'

// Which side of the toggle a unit is on. Spoons are on neither: a metric
// recipe measures in tablespoons as readily as an American one, and "30 ml
// olive oil" helps nobody. Milligrams, seconds, minutes, hours and counts are
// the same everywhere.
const SYSTEM: Partial<Record<Unit, UnitSystem>> = {
  g: 'metric', kg: 'metric', ml: 'metric', l: 'metric', celsius: 'metric', mm: 'metric', cm: 'metric',
  oz: 'imperial', lb: 'imperial', cup_us: 'imperial', cup_metric: 'imperial',
  fl_oz_us: 'imperial', fl_oz_imperial: 'imperial', fahrenheit: 'imperial', inch: 'imperial',
}

const systemOf = (unit: Unit | null, lang: string) => unit ? SYSTEM[resolveUnit(unit, lang)] : undefined

function* quantitiesOf(recipe: ExtractedRecipe) {
  for (const ingredient of recipe.ingredients) if (ingredient.quantity) yield ingredient.quantity
  for (const step of recipe.steps) yield* Object.values(step.quantities)
}

/** The system most of the recipe is written in; the language's, where it is even or says nothing. */
export function recipeSystem(recipe: ExtractedRecipe): UnitSystem {
  let balance = 0
  for (const quantity of quantitiesOf(recipe)) {
    const system = systemOf(quantity.unit, recipe.source_lang)
    if (system) balance += system === 'metric' ? 1 : -1
  }
  if (balance) return balance > 0 ? 'metric' : 'imperial'
  return unitRegion(recipe.source_lang) === 'us' ? 'imperial' : 'metric'
}

/** Whether switching systems would change anything this recipe shows. */
export const hasConvertible = (recipe: ExtractedRecipe) =>
  [...quantitiesOf(recipe)].some(quantity => systemOf(quantity.unit, recipe.source_lang))

// How much of the base unit — a gram, a millilitre, a millimetre — one of
// each holds.
const BASE: Partial<Record<Unit, number>> = {
  g: 1, kg: 1000, oz: 28.3495, lb: 453.592,
  ml: 1, l: 1000, cup_us: 236.588, cup_metric: 250, fl_oz_us: 29.5735, fl_oz_imperial: 28.4131,
  tsp_us: 4.92892, tbsp_us: 14.7868,
  mm: 1, cm: 10, inch: 25.4,
}

// Rounded the way a kitchen measures (recipeScale.ts): grams to 5 g, cups to
// thirds and quarters, spoons to eighths.

// The unit an amount is best read in, chosen from its largest value so both
// ends of a range come out in the same one.
function target(base: number, from: Unit, to: UnitSystem): Unit {
  if (from === 'fahrenheit' || from === 'celsius') return to === 'metric' ? 'celsius' : 'fahrenheit'
  const kind = from === 'mm' || from === 'cm' || from === 'inch' ? 'length'
    : from === 'g' || from === 'kg' || from === 'oz' || from === 'lb' ? 'mass' : 'volume'
  if (to === 'metric') {
    if (kind === 'mass') return base >= 1000 ? 'kg' : 'g'
    if (kind === 'volume') return base >= 1000 ? 'l' : 'ml'
    return base >= 10 ? 'cm' : 'mm'
  }
  if (kind === 'mass') return base >= BASE.lb! ? 'lb' : 'oz'
  // Converting into imperial means US measures: that is who reads in cups.
  if (kind === 'volume') return base >= BASE.cup_us! / 4 ? 'cup_us' : base >= BASE.tbsp_us! ? 'tbsp_us' : 'tsp_us'
  return 'inch'
}

function temperature(value: number, to: Unit): number {
  const converted = to === 'celsius' ? (value - 32) * 5 / 9 : value * 9 / 5 + 32
  return converted >= 100 ? Math.round(converted / 5) * 5 : Math.round(converted)
}

/** The same amount in the other system, or unchanged if it is already in this one or belongs to neither. */
export function convertQuantity(quantity: Quantity, lang: string, system: UnitSystem): Quantity {
  if (!quantity.unit) return quantity
  const unit = resolveUnit(quantity.unit, lang)
  const from = SYSTEM[unit]
  if (!from || from === system) return { ...quantity, unit }

  if (unit === 'fahrenheit' || unit === 'celsius') {
    const to = target(0, unit, system)
    const maxValue = quantity.maxValue === null ? null : temperature(quantity.maxValue, to)
    return { value: temperature(quantity.value, to), maxValue, unit: to }
  }

  const factor = BASE[unit]!
  const to = target((quantity.maxValue ?? quantity.value) * factor, unit, system)
  const round = (value: number) => {
    const converted = value * factor / BASE[to]!
    return system === 'metric' ? metric(converted, to) : kitchen(converted, to)
  }
  return { value: round(quantity.value), maxValue: quantity.maxValue === null ? null : round(quantity.maxValue), unit: to }
}

// ── Printing ───────────────────────────────────────────────────────────────

// [one, many]. The regional variants print as the plain word — "1 cup".
const LABEL: Record<Unit, [string, string]> = {
  g: ['g', 'g'], kg: ['kg', 'kg'], mg: ['mg', 'mg'], oz: ['oz', 'oz'], lb: ['lb', 'lb'],
  ml: ['ml', 'ml'], l: ['l', 'l'],
  cup: ['cup', 'cups'], cup_us: ['cup', 'cups'], cup_metric: ['cup', 'cups'],
  tbsp: ['tbsp', 'tbsp'], tbsp_us: ['tbsp', 'tbsp'], tbsp_metric: ['tbsp', 'tbsp'], tbsp_au: ['tbsp', 'tbsp'],
  tsp: ['tsp', 'tsp'], tsp_us: ['tsp', 'tsp'], tsp_metric: ['tsp', 'tsp'],
  fl_oz: ['fl oz', 'fl oz'], fl_oz_us: ['fl oz', 'fl oz'], fl_oz_imperial: ['fl oz', 'fl oz'],
  celsius: ['°C', '°C'], fahrenheit: ['°F', '°F'],
  second: ['s', 's'], minute: ['min', 'min'], hour: ['h', 'h'],
  mm: ['mm', 'mm'], cm: ['cm', 'cm'], inch: ['in', 'in'],
  count: ['', ''],
}

// Cups and spoons are measured in halves and thirds, and read that way; grams
// and millilitres in decimals.
const FRACTIONAL = new Set<Unit>([
  'cup', 'cup_us', 'cup_metric', 'tbsp', 'tbsp_us', 'tbsp_metric', 'tbsp_au',
  'tsp', 'tsp_us', 'tsp_metric', 'fl_oz', 'fl_oz_us', 'fl_oz_imperial',
  'oz', 'lb', 'inch', 'hour', 'count',
])

const GLYPHS: [number, string][] = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
]

// "und", or a tag the runtime does not know, would otherwise fall back to the
// machine's own locale — a different decimal mark on the server than in the
// browser, and a hydration mismatch.
function locale(lang: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf(lang)[0] ?? 'en'
  } catch {
    return 'en'
  }
}

const decimal = (value: number, lang: string) =>
  new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value)

function number(value: number, unit: Unit | null, lang: string): string {
  if (unit && !FRACTIONAL.has(unit)) return decimal(value, lang)
  const whole = Math.floor(value)
  const glyph = GLYPHS.find(([fraction]) => Math.abs(value - whole - fraction) < 0.01)?.[1]
  if (glyph) return whole ? `${whole}${glyph}` : glyph
  return decimal(value, lang)
}

/** "1½ cups", "180 °C", "2–3", "1,2 kg" — the number in the recipe's own notation. */
export function formatQuantity(quantity: Quantity, lang: string): string {
  const unit = quantity.unit ? resolveUnit(quantity.unit, lang) : null
  const low = number(quantity.value, unit, lang)
  const amount = quantity.maxValue === null ? low : `${low}–${number(quantity.maxValue, unit, lang)}`
  if (!unit) return amount
  const [one, many] = LABEL[unit]
  const label = (quantity.maxValue ?? quantity.value) > 1 ? many : one
  return label ? `${amount} ${label}` : amount
}

/** Minutes as a person would say them: "25 min", "1 h 30 min", "2 h". */
export function formatMinutes(minutes: number | null): string | null {
  if (minutes === null) return null
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

// ── Ingredients ────────────────────────────────────────────────────────────

export type IngredientText = {
  amount: string | null
  name: string
  extra: string | null
  // Scaled, but this line could not be: no amount was read out of it
  // ("salt to taste"). Said, rather than silently left as it was.
  unscaled: boolean
}

// The number at the start of an amount the parser read but could not name
// the unit of: the "4" of "4 TL", the "2–3" of "2–3 Zehen".
const LEADING_AMOUNT = /^\s*(?:\d+(?:[.,]\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+|[½⅓⅔¼¾⅛])[½⅓⅔¼¾⅛]?(?:\s*(?:-|–|—|to|bis)\s*(?:\d+(?:[.,]\d+)?|[½⅓⅔¼¾⅛]))?/i

/**
 * An amount as shown: scaled, then in the chosen system. The line the reader
 * set as the anchor shows what they typed, not a rounding of it.
 */
function amountOf(quantity: Quantity, lang: string, system: UnitSystem, scale: Scale, anchored: boolean): string {
  if (anchored && scale.value !== null) {
    const shown = convertQuantity(quantity, lang, system)
    const maxValue = shown.maxValue === null ? null : Math.round(shown.maxValue * scale.factor * 100) / 100
    return formatQuantity({ ...shown, value: scale.value, maxValue }, lang)
  }
  return formatQuantity(convertQuantity(scaleQuantity(quantity, scale.factor), lang, system), lang)
}

export function ingredientText(ingredient: Ingredient, lang: string, system: UnitSystem, scale: Scale = UNSCALED): IngredientText {
  const { quantity, quantityText } = ingredient
  const scaled = scale.factor !== 1
  const line = { name: ingredient.name, extra: ingredient.extra }
  if (!quantity) return { ...line, amount: quantityText, unscaled: scaled }
  // A unit the parser did not know ("2 Zehen", "4 TL") prints as written:
  // printing only the number would drop the word that says how much. Scaled,
  // the number is swapped for the scaled one and the word kept.
  if (!quantity.unit && quantityText) {
    if (!scaled) return { ...line, amount: quantityText, unscaled: false }
    const number = LEADING_AMOUNT.exec(quantityText)
    if (!number) return { ...line, amount: quantityText, unscaled: true }
    const anchored = scale.anchor === ingredient.id
    const amount = amountOf(quantity, lang, system, scale, anchored)
    return { ...line, amount: `${amount}${quantityText.slice(number[0].length)}`, unscaled: false }
  }
  return { ...line, amount: amountOf(quantity, lang, system, scale, scale.anchor === ingredient.id), unscaled: false }
}

/**
 * What an ingredient's amount is, in the units it is shown in, for setting it
 * as the anchor: the number the reader starts from and the unit they are
 * typing in. Null for a line with no amount to set.
 */
export function anchorOf(ingredient: Ingredient, lang: string, system: UnitSystem): { value: number, unit: string } | null {
  const { quantity, quantityText } = ingredient
  if (!quantity) return null
  if (!quantity.unit) {
    const number = quantityText ? LEADING_AMOUNT.exec(quantityText) : null
    if (quantityText && !number) return null
    return { value: quantity.value, unit: quantityText && number ? quantityText.slice(number[0].length).trim() : '' }
  }
  const shown = convertQuantity(quantity, lang, system)
  const unit = shown.unit ? resolveUnit(shown.unit, lang) : null
  const [one, many] = unit ? LABEL[unit] : ['', '']
  return { value: shown.value, unit: shown.value > 1 ? many : one }
}

// ── Steps ──────────────────────────────────────────────────────────────────

// "1. ", "2) ", "Step 3: ", "Schritt 4. ". The punctuation has to be followed
// by a space, so "1.5 kg flour" is an amount and not step one.
const LEADING_NUMBER = /^\s*(?:(?:step|schritt|étape|paso|stap)\s*)?(\d{1,3})\s*[.):](?:\s+|$)/i

export type StepText = {
  // The number the step is shown with, or null for a step the source left
  // unnumbered among numbered ones — a "Marinade:" preamble, a serving note.
  number: number | null
  parts: StepPart[]
}

/**
 * The model keeps a source's own numbering inside the step. When the source
 * numbered its steps, those numbers are the ones shown and taken out of the
 * text, and a step it did not number stays unnumbered rather than pushing the
 * rest along. When it numbered none, they are counted from one.
 */
/** A step's own leading number and the text after it, or null if it has none. */
export function splitStepNumber(text: string): { number: number, rest: string } | null {
  const match = LEADING_NUMBER.exec(text)
  return match ? { number: Number(match[1]), rest: text.slice(match[0].length) } : null
}

export function stepTexts(steps: Step[]): StepText[] {
  const numbers = steps.map(step => {
    const first = step.parts[0]
    return first?.type === 'text' ? LEADING_NUMBER.exec(first.value) : null
  })
  if (!numbers.some(Boolean)) {
    return steps.map((step, index) => ({ number: index + 1, parts: step.parts }))
  }
  return steps.map((step, index) => {
    const match = numbers[index]
    if (!match) return { number: null, parts: step.parts }
    const [first, ...rest] = step.parts as [StepPart & { type: 'text' }, ...StepPart[]]
    const remainder = first.value.slice(match[0].length)
    return {
      number: Number(match[1]),
      parts: remainder ? [{ type: 'text', value: remainder }, ...rest] : rest,
    }
  })
}

export type PartText = {
  text: string
  amount: boolean
  // Scaled, and this amount was not: nothing says whether it grows with the
  // recipe, so it is left as the source wrote it and marked.
  unscaled: boolean
}

/**
 * A step part as it reads. A restated ingredient amount is printed from the
 * ingredient, so the two cannot disagree when the recipe is scaled.
 */
export function partText(
  part: StepPart, step: Step, ingredients: Map<string, Ingredient>, lang: string, system: UnitSystem, scale: Scale = UNSCALED,
): PartText {
  if (part.type === 'text') return { text: part.value, amount: false, unscaled: false }
  if (part.type === 'ingredientQuantity') {
    const quantity = ingredients.get(part.ingredientId)?.quantity
    // A reference to nothing is a stored recipe that was edited around; the
    // amount is lost either way, and an empty string does not break the sentence.
    if (!quantity) return { text: '', amount: false, unscaled: false }
    return { text: amountOf(quantity, lang, system, scale, scale.anchor === part.ingredientId), amount: true, unscaled: false }
  }
  const quantity = step.quantities[part.quantity]
  if (!quantity) return { text: '', amount: false, unscaled: false }
  const scaling = stepScaling(quantity)
  const shown = scaling === 'scales' ? scaleQuantity(quantity, scale.factor) : quantity
  return {
    text: formatQuantity(convertQuantity(shown, lang, system), lang),
    amount: true,
    unscaled: scale.factor !== 1 && scaling === 'unknown',
  }
}
