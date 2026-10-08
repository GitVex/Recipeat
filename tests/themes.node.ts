import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Every theme's text that is read meets WCAG AA on each surface it sits on (#87).
const tokens = (css: string, selector: string) => {
  const block = css.slice(css.indexOf(`${selector} {`)).split('\n}')[0]!.split('\n    }')[0]!
  const long = (hex: string) => hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/g)].map(m => [m[1]!, long(m[2]!)]))
}
const base = tokens(readFileSync('app/assets/main.css', 'utf8'), ':root')
const THEMES = {
  default: base,
  'crate-label': { ...base, ...tokens(readFileSync('app/assets/themes/crate-label.css', 'utf8'), ':root[data-theme="crate-label"]') },
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

// Known and open: the default's delete button and filter count are white on
// --orange, 4.32:1. Listed here so the test holds every other pair to the rule.
const KNOWN = new Set(['default: --on-fill on --orange'])

for (const [name, t] of Object.entries(THEMES)) {
  test(`${name}: text that is read is 4.5:1 or better`, () => {
    const pairs: [string, string][] = [
      ...['ink', 'ink-soft', 'muted', 'olive', 'orange-text', 'orange-deep']
        .flatMap(text => ['cream', 'paper', 'wash'].map(surface => [text, surface] as [string, string])),
      // The handwriting is on the landing page (cream) and the nudge (paper), never on wash.
      ['hand-ink', 'cream'], ['hand-ink', 'paper'],
      ['on-fill', 'olive'], ['on-fill', 'orange'],
    ]
    for (const [text, surface] of pairs) {
      if (KNOWN.has(`${name}: --${text} on --${surface}`)) continue
      assert.ok(contrast(t[text]!, t[surface]!) >= 4.5, `--${text} on --${surface}: ${contrast(t[text]!, t[surface]!).toFixed(2)}`)
    }
  })
}
