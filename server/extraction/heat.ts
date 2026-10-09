import type { HeatLevel, StepPart } from './recipe.ts'

// Heat levels in a step's words (#107): "over medium-high heat", "bei mittlerer
// Hitze". Only a level said of the heat counts, so "low-fat", "bring to a
// simmer" and "until boiling" stay plain text: a state is not a setting.
//
// Each word is a step on low (0), medium (1), high (2); two joined ("medium to
// high", "mittlerer bis starker") are the level between them.

const LEVELS: Record<string, HeatLevel | undefined> = {
  '0': 'low', '1': 'medium', '2': 'high', '00': 'low', '11': 'medium', '22': 'high',
  '01': 'medium-low', '10': 'medium-low', '12': 'medium-high', '21': 'medium-high',
}

type Language = { pattern: RegExp, step: (word: string) => number }

// Not after a letter: \b knows nothing of ä or ß.
const start = '(?<!\\p{L})'
const end = '(?!\\p{L})'

const EN_WORD = '(low|gentle|medium|med|moderate(?:ly)?|high)'
const EN_PAIR = `${EN_WORD}(?:(?:\\s*[-–—]\\s*|\\s+to\\s+|\\s+)${EN_WORD})?`
const EN_STEPS: Record<string, number> = { low: 0, gentle: 0, medium: 1, med: 1, moderate: 1, moderately: 1, high: 2 }

// Adjective stems, any ending: mittlere, mittlerer, mittleren.
const DE_WORD = '(mittelstark|schwach|niedrig|klein|gering|mittler|mittel|mäßig|stark|hoh|groß)(?:e|er|en|em|es)?'
const DE_PAIR = `${DE_WORD}(?:\\s+bis\\s+${DE_WORD})?`
const DE_STEPS: Record<string, number> = {
  schwach: 0, niedrig: 0, klein: 0, gering: 0,
  mittelstark: 1, mittler: 1, mittel: 1, mäßig: 1,
  stark: 2, hoh: 2, groß: 2,
}

const LANGUAGES: Record<string, Language> = {
  en: {
    // "medium-high heat", or "reduce the heat to low".
    pattern: new RegExp(`${start}(?:${EN_PAIR}\\s+(?:heat|flame)|heat(?:\\s+(?:down|up|back))?\\s+to\\s+${EN_PAIR})${end}`, 'giu'),
    step: word => EN_STEPS[word.toLowerCase()]!,
  },
  de: {
    pattern: new RegExp(`${start}${DE_PAIR}\\s+(?:Hitze|Flamme|Stufe)${end}`, 'giu'),
    step: word => DE_STEPS[word.toLowerCase()]!,
  },
}

/** The step's text parts with each heat level it names made a heat part; other parts as they were. */
export function heatParts(parts: StepPart[], sourceLang: string): StepPart[] {
  const language = LANGUAGES[sourceLang.split('-')[0]!.toLowerCase()]
  if (!language) return parts
  return parts.flatMap((part) => {
    if (part.type !== 'text') return [part]
    const split: StepPart[] = []
    let cursor = 0
    for (const match of part.value.matchAll(language.pattern)) {
      const words = match.slice(1).filter((word): word is string => !!word)
      const level = LEVELS[words.map(language.step).join('')]
      // Low to high is no one level; it stays as written.
      if (!level) continue
      if (match.index > cursor) split.push({ type: 'text', value: part.value.slice(cursor, match.index) })
      split.push({ type: 'heat', level, value: match[0] })
      cursor = match.index + match[0].length
    }
    if (cursor < part.value.length) split.push({ type: 'text', value: part.value.slice(cursor) })
    return split
  })
}
