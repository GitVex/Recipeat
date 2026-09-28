import type { ExtractedRecipe, Ingredient, Quantity, RecipeSource, Step } from '../types/recipe.ts'
import { LIMITS } from './recipeLimits.ts'
import { formatMinutes, formatQuantity, splitStepNumber } from './recipeText.ts'

// A recipe as the editor holds it: text in every field, the way a person
// types it. The structure — parsed amounts, step parts, the links between
// them — is the server's to rebuild on save, so nothing here parses more than
// the two numbers it must send as numbers.

export type IngredientEdit = {
  key: string
  amount: string
  name: string
  extra: string
  // The ingredient this row started as, or null for one added here. An
  // untouched row goes back as it came, parsed amount and all.
  from: Ingredient | null
}

export type StepEdit = {
  key: string
  text: string
  // The source's own number, taken off the text for editing and put back on
  // save while the steps keep their order.
  number: number | null
  from: Step | null
}

export type RecipeEdit = {
  title: string
  portions: string
  totalTime: string
  ingredients: IngredientEdit[]
  steps: StepEdit[]
}

// What POST /api/recipes and PUT /api/recipes/{id} accept.
export type RecipeBody = {
  title: string | null
  source_lang: string
  portions: number | null
  totalTime: number | null
  image: string | null
  source: RecipeSource
  ingredients: {
    originalText: string
    name: string
    quantityText: string | null
    quantity?: Quantity | null
    extra: string | null
  }[]
  steps: string[]
}

let counter = 0
export const newKey = (kind: string) => `new-${kind}-${++counter}`

// The amount as it was written, which is what a person edits. An amount that
// only exists as numbers (a source that parsed it itself) is written out.
const amountOf = (ingredient: Ingredient, lang: string) =>
  ingredient.quantityText ?? (ingredient.quantity ? formatQuantity(ingredient.quantity, lang) : '')

export const blankIngredient = (): IngredientEdit => ({ key: newKey('ingredient'), amount: '', name: '', extra: '', from: null })
export const blankStep = (): StepEdit => ({ key: newKey('step'), text: '', number: null, from: null })

export function editOf(recipe: ExtractedRecipe): RecipeEdit {
  // Only a recipe whose source numbered its steps has numbers to take off:
  // "2 eggs, beaten" in an unnumbered one is not step two.
  const numbered = recipe.steps.some(step => splitStepNumber(step.originalText))
  return {
    title: recipe.title ?? '',
    portions: recipe.portions === null ? '' : String(recipe.portions),
    totalTime: formatMinutes(recipe.totalTime) ?? '',
    ingredients: recipe.ingredients.map(ingredient => ({
      key: ingredient.id,
      amount: amountOf(ingredient, recipe.source_lang),
      name: ingredient.name,
      extra: ingredient.extra ?? '',
      from: ingredient,
    })),
    steps: recipe.steps.map((step) => {
      const split = numbered ? splitStepNumber(step.originalText) : null
      return { key: step.id, text: split ? split.rest : step.originalText, number: split?.number ?? null, from: step }
    }),
  }
}

const HOURS = /^(?:h|hr|hrs|hour|hours|std|stunde|stunden)$/i
const MINUTES = /^(?:m|min|mins|minute|minutes|minuten)$/i

/**
 * Minutes from how a person writes a duration: "45", "45 min", "1 h 30 min",
 * "1.5 h", "2h30", "1:30". Null for nothing written; undefined for something
 * that is not a duration.
 */
export function parseMinutes(text: string): number | null | undefined {
  const value = text.trim().toLowerCase()
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value) || undefined
  const clock = /^(\d+):([0-5]\d)$/.exec(value)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) || undefined

  let total = 0
  let rest = value
  let lastWasHours = false
  while (rest) {
    const token = /^(\d+(?:[.,]\d+)?)\s*([a-zäöü]*)\s*/.exec(rest)
    if (!token) return undefined
    const amount = Number(token[1]!.replace(',', '.'))
    const unit = token[2]!
    // "2h30": a bare number after hours is minutes.
    if (HOURS.test(unit)) { total += amount * 60; lastWasHours = true }
    else if (MINUTES.test(unit) || (!unit && lastWasHours)) { total += amount; lastWasHours = false }
    else return undefined
    rest = rest.slice(token[0].length)
  }
  const minutes = Math.round(total)
  return minutes > 0 ? minutes : undefined
}

/** A positive number of portions, "4" or "4,5". Null for nothing; undefined for anything else. */
export function parsePortions(text: string): number | null | undefined {
  const value = text.trim()
  if (!value) return null
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return undefined
  const portions = Number(value.replace(',', '.'))
  return portions > 0 ? portions : undefined
}

// An ingredient line as a person would write it, for a row that was edited:
// its original wording no longer describes it.
const lineOf = (row: IngredientEdit) => {
  const main = [row.amount.trim(), row.name.trim()].filter(Boolean).join(' ')
  const extra = row.extra.trim()
  if (!main || !extra) return main || extra
  // "(peeled and smashed)" is already set apart by its brackets.
  return extra.startsWith('(') ? `${main} ${extra}` : `${main}, ${extra}`
}

/** Whether an ingredient row still says exactly what it started as. */
export const ingredientUntouched = (row: IngredientEdit, lang: string) =>
  row.from !== null
  && row.amount === amountOf(row.from, lang)
  && row.name === row.from.name
  && row.extra === (row.from.extra ?? '')

/** Whether the steps are still the recipe's own, in its order: none added, removed or moved. */
export const stepsInOrder = (recipe: ExtractedRecipe, edit: RecipeEdit) =>
  edit.steps.length === recipe.steps.length
  && edit.steps.every((row, index) => row.from === recipe.steps[index])

export type EditProblem = 'totalTime' | 'portions' | 'empty'

/**
 * The request body for an edited recipe, or what stops it being sent. Rows
 * left untouched go back exactly as they came; edited ones go back as text,
 * and the server reads the amounts out of them again.
 */
export function bodyOf(recipe: ExtractedRecipe, edit: RecipeEdit): { body: RecipeBody | null, problems: EditProblem[] } {
  const problems: EditProblem[] = []
  const totalTime = parseMinutes(edit.totalTime)
  if (totalTime === undefined || (totalTime !== null && totalTime > LIMITS.totalTime)) problems.push('totalTime')
  const portions = parsePortions(edit.portions)
  if (portions === undefined) problems.push('portions')

  const ingredients = edit.ingredients
    .map((row) => {
      if (ingredientUntouched(row, recipe.source_lang)) {
        const { originalText, name, quantityText, quantity, extra } = row.from!
        return { originalText, name, quantityText, quantity, extra }
      }
      const originalText = lineOf(row)
      if (!originalText) return null
      return {
        originalText,
        name: row.name.trim() || originalText,
        quantityText: row.amount.trim() || null,
        extra: row.extra.trim() || null,
      }
    })
    .filter(ingredient => ingredient !== null)

  // While the steps keep their order, each keeps its source number and an
  // untouched one its exact wording. Once they are added to, removed or
  // moved, those numbers describe a sequence that no longer exists, and the
  // page counts them instead.
  const inOrder = stepsInOrder(recipe, edit)
  const startText = new Map(editOf(recipe).steps.map(row => [row.key, row.text]))
  const steps = edit.steps
    .map((row) => {
      if (inOrder && row.from && row.text === startText.get(row.key)) return row.from.originalText
      const text = row.text.trim()
      if (!text) return ''
      return inOrder && row.number !== null ? `${row.number}. ${text}` : text
    })
    .filter(Boolean)

  if (!ingredients.length && !steps.length) problems.push('empty')
  if (problems.length) return { body: null, problems }

  return {
    body: {
      title: edit.title.trim() || null,
      source_lang: recipe.source_lang,
      portions: portions ?? null,
      totalTime: totalTime ?? null,
      image: recipe.image,
      source: recipe.source,
      ingredients,
      steps,
    },
    problems,
  }
}

/** Whether the edit says anything the recipe does not. */
export function isEdited(recipe: ExtractedRecipe, edit: RecipeEdit): boolean {
  const start = editOf(recipe)
  const rows = <T extends { from: unknown }>(list: T[]) => list.map(({ from: _from, key: _key, ...row }) => row)
  return edit.title !== start.title
    || edit.portions !== start.portions
    || edit.totalTime !== start.totalTime
    || JSON.stringify(rows(edit.ingredients)) !== JSON.stringify(rows(start.ingredients))
    || JSON.stringify(rows(edit.steps)) !== JSON.stringify(rows(start.steps))
    || edit.ingredients.some((row, index) => row.from !== recipe.ingredients[index])
    || edit.steps.some((row, index) => row.from !== recipe.steps[index])
}
