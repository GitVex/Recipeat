import type { ExtractedRecipe, Ingredient, Quantity, Step, StepPart, Unit } from '../types/recipe.ts'

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

// The fractions each is measured in: a set of cups has thirds, spoons go down
// to an eighth, and a scale or a ruler reads in quarters.
const CUP = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1]
const SPOON = [0, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1]
const QUARTERS = [0, 1 / 4, 1 / 2, 3 / 4, 1]

function kitchen(value: number, unit: Unit): number {
  if (value >= 10) return Math.round(value)
  const fractions = unit === 'cup_us' ? CUP : unit === 'tbsp_us' || unit === 'tsp_us' ? SPOON : QUARTERS
  const whole = Math.floor(value)
  const rest = value - whole
  const nearest = fractions.reduce((best, fraction) => Math.abs(fraction - rest) < Math.abs(best - rest) ? fraction : best)
  // Never round an amount away to nothing.
  return whole + nearest || fractions[1]!
}

function metric(value: number, unit: Unit): number {
  if (unit === 'kg' || unit === 'l') return Math.round(value * 20) / 20
  if (value >= 100) return Math.round(value / 5) * 5
  if (value >= 10) return Math.round(value)
  return Math.round(value * 10) / 10 || 0.1
}

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

// ── Ingredients ────────────────────────────────────────────────────────────

export type IngredientText = { amount: string | null, name: string, extra: string | null }

export function ingredientText(ingredient: Ingredient, lang: string, system: UnitSystem): IngredientText {
  const { quantity, quantityText } = ingredient
  // A unit the parser did not know ("2 Zehen", "4 TL") prints as written:
  // printing only the number would drop the word that says how much.
  const amount = quantity && (quantity.unit || !quantityText)
    ? formatQuantity(convertQuantity(quantity, lang, system), lang)
    : quantityText
  return { amount, name: ingredient.name, extra: ingredient.extra }
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

export type PartText = { text: string, amount: boolean }

/**
 * A step part as it reads. A restated ingredient amount is printed from the
 * ingredient, so the two cannot disagree once #44 rescales one of them.
 */
export function partText(part: StepPart, step: Step, ingredients: Map<string, Ingredient>, lang: string, system: UnitSystem): PartText {
  if (part.type === 'text') return { text: part.value, amount: false }
  const quantity = part.type === 'measurement'
    ? step.quantities[part.quantity]
    : ingredients.get(part.ingredientId)?.quantity
  // A reference to nothing is a stored recipe that was edited around; the
  // amount is lost either way, and an empty string does not break the sentence.
  if (!quantity) return { text: '', amount: false }
  return { text: formatQuantity(convertQuantity(quantity, lang, system), lang), amount: true }
}
