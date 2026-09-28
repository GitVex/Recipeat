import type { ExtractedRecipe, Ingredient, IngredientChange, RecipeChanges, Snippet, Step, StepChange } from '../types/recipe.ts'
import { formatMinutes, formatQuantity } from './recipeText.ts'

// What changed between two versions of a recipe: counted, and itemised far
// enough to tell versions apart in a lineage (#31) — which ingredient and by
// how much, which step and a few words either side of what changed. Versions
// are whole copies, so this compares two recipes as they stand, not a record
// of edits.
//
// Ingredient and step ids are rebuilt from position on every save, so they
// say nothing about which item became which. Ingredients are matched by name
// instead, and a matched one whose line reads differently is "changed".
// Steps are matched by their text; what is left over on both sides is paired
// in order and counted as changed, and only the surplus as added or removed.
// A step reworded and moved at once can read as one removed and one added.

type Content = Pick<ExtractedRecipe, 'title' | 'portions' | 'totalTime' | 'ingredients' | 'steps'> & {
  source_lang?: string
}

// A version rewritten from end to end would otherwise carry every line of
// itself into a history read. The counts stay whole; the items stop here.
export const MAX_ITEMS = 12
// Words of unchanged text kept either side of a change, and the most of the
// change itself a snippet carries.
const CONTEXT = 4
const CHANGED = 14

const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

function group<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

const clip = (words: string[], max: number) =>
  words.length > max ? `${words.slice(0, max).join(' ')} …` : words.join(' ')

/**
 * The words that differ between two texts, with a few either side: the
 * common start and end are trimmed away, since a changed step is usually
 * a number or a phrase inside a long paragraph.
 */
export function snippet(from: string, to: string): Snippet {
  const a = from.trim().split(/\s+/).filter(Boolean)
  const b = to.trim().split(/\s+/).filter(Boolean)
  let start = 0
  while (start < a.length && start < b.length && normal(a[start]!) === normal(b[start]!)) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && normal(a[a.length - 1 - end]!) === normal(b[b.length - 1 - end]!)) end++
  const lead = b.slice(Math.max(0, start - CONTEXT), start)
  const trail = b.slice(b.length - end, b.length - end + CONTEXT)
  return {
    before: (start > CONTEXT ? '… ' : '') + lead.join(' '),
    removed: clip(a.slice(start, a.length - end), CHANGED),
    added: clip(b.slice(start, b.length - end), CHANGED),
    after: trail.join(' ') + (end > CONTEXT ? ' …' : ''),
  }
}

const whole = (text: string, key: 'added' | 'removed'): Snippet => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return { before: '', removed: '', added: '', after: '', [key]: clip(words, CHANGED) }
}

const amountOf = (ingredient: Ingredient, lang: string) =>
  ingredient.quantityText?.trim() || (ingredient.quantity ? formatQuantity(ingredient.quantity, lang) : null)

// By how much, where that has an answer: the same unit on both sides and a
// single number each, not a range. "2 cloves" to "3" is +1; "1 cup" to
// "250 ml" is not a difference anyone would read.
function difference(from: Ingredient, to: Ingredient, lang: string): string | null {
  const [a, b] = [from.quantity, to.quantity]
  if (!a || !b || a.unit !== b.unit || a.maxValue !== null || b.maxValue !== null) return null
  const delta = Math.round((b.value - a.value) * 1000) / 1000
  if (!delta) return null
  const size = formatQuantity({ value: Math.abs(delta), maxValue: null, unit: a.unit }, lang)
  return `${delta > 0 ? '+' : '−'}${size}`
}

export function recipeChanges(from: Content, to: Content): RecipeChanges {
  const lang = to.source_lang ?? from.source_lang ?? 'en'

  // Ingredients: by name, then by how the line reads. Listed in the order of
  // the newer version, with what it no longer has at the end.
  const byName = group(from.ingredients, ingredient => normal(ingredient.name))
  const ingredients: IngredientChange[] = []
  for (const ingredient of to.ingredients) {
    const before = byName.get(normal(ingredient.name))?.shift()
    if (!before) {
      ingredients.push({ kind: 'added', name: ingredient.name, text: ingredient.originalText })
    } else if (normal(before.originalText) !== normal(ingredient.originalText)) {
      const [was, now] = [amountOf(before, lang), amountOf(ingredient, lang)]
      ingredients.push({
        kind: 'changed',
        name: ingredient.name,
        // The amount when that is what moved; otherwise the words around it.
        amount: was !== now ? { from: was, to: now, by: difference(before, ingredient, lang) } : null,
        snippet: was !== now ? null : snippet(before.originalText, ingredient.originalText),
      })
    }
  }
  for (const left of byName.values()) {
    for (const ingredient of left) ingredients.push({ kind: 'removed', name: ingredient.name, text: ingredient.originalText })
  }

  // Steps: by text; the rest paired in order. Numbered as the newer version
  // numbers them, and a removed step by where it stood in the older one.
  const byText = group(from.steps.map((step, index) => ({ step, number: index + 1 })), ({ step }) => normal(step.originalText))
  const unmatched: { step: Step, number: number }[] = []
  to.steps.forEach((step, index) => {
    if (!byText.get(normal(step.originalText))?.shift()) unmatched.push({ step, number: index + 1 })
  })
  const gone = [...byText.values()].flat().sort((a, b) => a.number - b.number)
  const steps: StepChange[] = []
  unmatched.forEach(({ step, number }, index) => {
    const was = gone[index]
    steps.push(was
      ? { kind: 'changed', number, snippet: snippet(was.step.originalText, step.originalText) }
      : { kind: 'added', number, snippet: whole(step.originalText, 'added') })
  })
  for (const { step, number } of gone.slice(unmatched.length)) {
    steps.push({ kind: 'removed', number, snippet: whole(step.originalText, 'removed') })
  }

  const counted = <T extends { kind: string }>(items: T[]) => ({
    added: items.filter(item => item.kind === 'added').length,
    removed: items.filter(item => item.kind === 'removed').length,
    changed: items.filter(item => item.kind === 'changed').length,
    items: items.slice(0, MAX_ITEMS),
  })

  return {
    title: normal(from.title ?? '') !== normal(to.title ?? ''),
    portions: from.portions === to.portions ? null : [from.portions, to.portions],
    totalTime: from.totalTime === to.totalTime ? null : [from.totalTime, to.totalTime],
    ingredients: counted(ingredients),
    steps: counted(steps),
  }
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The changes as short phrases, most telling first: "Renamed", "+2
 * ingredients", "1 ingredient changed", "Serves 4 → 6". Empty when the two
 * read the same.
 */
export function describeChanges(changes: RecipeChanges): string[] {
  const phrases: string[] = []
  if (changes.title) phrases.push('Renamed')
  const { ingredients, steps } = changes
  if (ingredients.added) phrases.push(`+${count(ingredients.added, 'ingredient')}`)
  if (ingredients.removed) phrases.push(`−${count(ingredients.removed, 'ingredient')}`)
  if (ingredients.changed) phrases.push(`${count(ingredients.changed, 'ingredient')} changed`)
  if (steps.added) phrases.push(`+${count(steps.added, 'step')}`)
  if (steps.removed) phrases.push(`−${count(steps.removed, 'step')}`)
  if (steps.changed) phrases.push(`${count(steps.changed, 'step')} changed`)
  if (changes.portions) {
    const [before, after] = changes.portions
    phrases.push(`Serves ${before ?? '?'} → ${after ?? '?'}`)
  }
  if (changes.totalTime) {
    const [before, after] = changes.totalTime
    phrases.push(`${formatMinutes(before) ?? 'No time'} → ${formatMinutes(after) ?? 'no time'}`)
  }
  return phrases
}
