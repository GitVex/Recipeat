import pluralize from 'pluralize'

/**
 * Step 1 of canonization (#154): the key alias lookup and alias writes share.
 * It collapses spelling noise only (case, whitespace, Unicode forms,
 * diacritics, punctuation, plurals) and never decides what a food is, so
 * "kashmiri chili powder" and "chili powder" stay apart.
 *
 * Changing a language's folding, or adding one, changes keys already stored
 * for it; the same change has to re-normalize that language's aliases.
 */

// Plurals pluralize gets wrong in a way that splits a singular from its
// plural ("chilies" → "chily" while "chili" stays).
pluralize.addIrregularRule('chili', 'chilies')
pluralize.addIrregularRule('chilli', 'chillies')
pluralize.addIrregularRule('cookie', 'cookies')

// German plurals by ending, first match wins. "-er" plurals are listed rather
// than ruled, since stripping "-er" folds Butter into Butt. Each result ends
// where no rule applies again, so folding twice changes nothing.
const GERMAN: [ending: string, singular: string][] = [
  ['eier', 'ei'],
  ['krauter', 'kraut'],
  ['blatter', 'blatt'],
  ['ssen', 'ss'], // Nüssen
  ['sse', 'ss'], // Nüsse
  ['eln', 'el'], // Zwiebeln, Kartoffeln
  ['en', 'e'], // Tomaten, Erbsen
]

type Fold = (word: string) => string

// One entry per language; a language without one keeps its plurals, and its
// aliases cover them.
const FOLD: Record<string, Fold> = {
  en: word => pluralize.singular(word),
  de: (word) => {
    const rule = GERMAN.find(([ending]) => word.endsWith(ending))
    return rule ? word.slice(0, -rule[0].length) + rule[1] : word
  },
}

const clean = (text: string) => text
  .normalize('NFKC')
  .normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

/**
 * The normalized form of an ingredient's name in a recipe of `lang`, or null
 * when nothing is left to key on. An amount the name still starts with (a
 * line whose name fell back to its whole text) is dropped by `quantityText`.
 */
export function normalizeName(name: string, lang: string, quantityText?: string | null): string | null {
  const fold = FOLD[lang.toLowerCase().split('-')[0]!] ?? (word => word)
  let text = clean(name)
  const amount = quantityText ? clean(quantityText) : ''
  if (amount && (text === amount || text.startsWith(`${amount} `))) text = text.slice(amount.length)
  return text.split(' ').filter(Boolean).map(fold).join(' ') || null
}
