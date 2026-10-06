// Writes docs/canonization.svg: #154's process for a new ingredient line, and
// 006_ingredients.sql's tables. Positions are by hand; move a box, check the arrows.
//
//   node scripts/canonization-diagram.mjs
import { writeFileSync } from 'node:fs'

const C = {
  ink: '#1f2430', muted: '#5b6372', line: '#8a93a3',
  db: ['#ecfdf5', '#5fb98c'], model: ['#eef2ff', '#7d8ff0'], plain: ['#f6f7f9', '#c3c9d3'],
  person: ['#fff7ed', '#e99a52'], fail: ['#fdf0f0', '#d55a55'], plan: ['#f7f1fd', '#9b6bd6'],
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const out = []
const text = (x, y, s, o = {}) => out.push(`<text x="${x}" y="${y}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''} font-size="${o.size ?? 12}"${o.weight ? ` font-weight="${o.weight}"` : ''} fill="${o.fill ?? C.ink}"${o.mono ? ' font-family="ui-monospace,Consolas,monospace"' : ''}>${esc(s)}</text>`)
const rect = (x, y, w, h, [fill, stroke], o = {}) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 8}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${o.dash ? ' stroke-dasharray="5 4"' : ''}/>`)
const path = (d, o = {}) => out.push(`<path d="${d}" fill="none" stroke="${o.stroke ?? C.line}" stroke-width="1.4"${o.dash ? ' stroke-dasharray="5 4"' : ''}${o.arrow === false ? '' : ` marker-end="url(#${o.marker ?? 'a'})"`}/>`)
// A step: bold title, then detail lines.
const step = (x, y, w, h, kind, title, ...lines) => {
  rect(x, y, w, h, C[kind], { dash: kind === 'plan' || kind === 'fail' })
  text(x + w / 2, y + 19, title, { anchor: 'middle', weight: 600, size: 13 })
  lines.forEach((l, i) => text(x + w / 2, y + 36 + 15 * i, l, { anchor: 'middle', size: 11.5, fill: C.muted }))
}

// ---- Process ----
text(30, 40, 'Canonization (#154)', { size: 22, weight: 700 })
text(30, 62, 'A new ingredient line, after its recipe is saved; schema from server/database/migrations/006_ingredients.sql', { size: 12.5, fill: C.muted })
text(30, 100, 'PROCESS', { size: 11, weight: 700, fill: C.muted })

const X = 60, W = 340, cx = X + W / 2
step(X, 112, W, 50, 'db', 'Recipe saved', 'enqueued in canonization_queue (#161)')
step(X, 182, W, 50, 'db', 'Worker takes it', 'FOR UPDATE SKIP LOCKED (#162)')
step(X, 252, W, 50, 'plain', '1 · Normalize the name (#157)', '"Zuccini" → alias_norm · lang = source_lang')
step(X, 322, W, 50, 'db', '2 · Alias lookup (#158)', '(alias_norm, lang) in ingredient_aliases')
step(X, 402, W, 50, 'model', '3a · English search terms (#159)', 'qwen3.5:4b → { terms[2..3], head }')
step(X, 472, W, 50, 'db', '3b · FDC candidates (#160)', 'pg_trgm + English FTS on fdc_foods')
step(X, 542, W, 50, 'model', '3c · Model picks twice (#160)', 'candidates shuffled · exact | proxy | none')
for (const [a, b] of [[162, 182], [232, 252], [302, 322], [452, 472], [522, 542]]) path(`M${cx} ${a} V${b - 2}`)
path(`M${cx} 372 V400`); text(cx + 8, 391, 'miss', { size: 11, fill: C.muted })

// Hit, and #167's seeded aliases beside it.
step(450, 322, 300, 50, 'db', 'Hit: key the line, done', 'not logged')
path(`M${X + W} 347 H448`); text(X + W + 10, 341, 'hit', { size: 11, fill: C.muted })
step(450, 392, 300, 84, 'plan', 'Planned (#167): OFF names as aliases', 'seeded per OFF release, source \'off\'', 'OFF FDC id accepted if 3b also finds it,', 'else a miss with that id as a candidate')
path('M600 392 V374', { dash: true, stroke: C.plan[1], arrow: false })

// Failure path.
step(450, 500, 300, 68, 'fail', 'Ollama down or answer invalid', 'attempts + 1, next_try_at backs off,', 'the recipe stays unkeyed (#162)')
path(`M${X + W} 427 H425 V534 H448`, { dash: true, stroke: C.fail[1], marker: 'f' })
path(`M${X + W} 567 H425`, { dash: true, stroke: C.fail[1], arrow: false })

// Branches of 3c.
path(`M${cx} 592 V606`, { arrow: false })
path('M130 606 H590', { arrow: false })
for (const x of [130, 360, 590]) path(`M${x} 606 V626`)
text(138, 620, 'same pick', { size: 11, fill: C.muted })
text(368, 620, 'none twice', { size: 11, fill: C.muted })
text(598, 620, 'disagree', { size: 11, fill: C.muted })
step(30, 628, 200, 66, 'db', '4 · Link the FDC entry', 'ingredients.fdc_id, fdc_match', 'exact + proxy → proxy')
step(260, 628, 200, 66, 'db', '5 · Match an existing', 'app ingredient, so "gochujang"', 'stays one row')
step(260, 728, 200, 66, 'plain', '6 · New ingredient', 'categorical fill from its', 'category, flagged for #155')
path('M360 694 V726'); text(368, 714, 'no match', { size: 11, fill: C.muted })
step(490, 628, 200, 66, 'person', 'Review (#156)', 'logged, outcome \'review\';', 'the line stays unkeyed')

step(30, 836, 430, 68, 'db', '7 · Write the alias, key the line (#164)', 'ingredient_aliases (source \'model\') · decision in', 'canonization_decisions · queue row deleted')
path('M130 694 V834')
path('M360 794 V834')
path('M260 661 H245 V834'); text(237, 760, 'match', { size: 11, fill: C.muted, anchor: 'end' })

// ---- Schema ----
text(800, 100, 'SCHEMA', { size: 11, weight: 700, fill: C.muted })
const TW = 240, head = 26, row = 17
const tables = {}
const table = (name, x, y, kind, cols, o = {}) => {
  const h = head + row * cols.length + 8
  rect(x, y, TW, h, ['#ffffff', C[kind][1]], { dash: o.dash })
  out.push(`<path d="M${x} ${y + head} V${y + 8} a8 8 0 0 1 8 -8 H${x + TW - 8} a8 8 0 0 1 8 8 V${y + head} Z" fill="${C[kind][0]}" stroke="${C[kind][1]}" stroke-width="1.4"/>`)
  text(x + 10, y + 18, name, { weight: 700, size: 12.5, mono: true })
  cols.forEach(([c, tag, planned], i) => {
    const ty = y + head + row * i + 13
    text(x + 10, ty, c, { size: 11.5, mono: true, fill: planned ? C.plan[1] : C.ink })
    if (tag) text(x + TW - 10, ty, tag, { size: 10.5, anchor: 'end', fill: planned ? C.plan[1] : C.muted })
  })
  tables[name] = { x, y, h, row: i => y + head + row * i + 9 }
}
table('recipes', 800, 112, 'plain', [['id', 'uuid PK'], ['…', 'existing']], { dash: true })
table('canonization_queue', 800, 200, 'plain', [['id', 'PK'], ['recipe_id', 'FK UNIQUE'], ['enqueued_at', ''], ['attempts', ''], ['next_try_at', 'indexed'], ['last_error', '']])
table('canonization_decisions', 800, 360, 'plain', [['id', 'PK'], ['recipe_id', 'FK set null'], ['name_raw', ''], ['name_norm', ''], ['lang', ''], ['search_terms', 'jsonb'], ['candidates', 'jsonb'], ['picks', 'jsonb'], ['outcome', "exact|proxy|none|review"], ['ingredient_id', 'FK'], ['model', ''], ['prompt_version', ''], ['created_at', '']])
table('ingredient_aliases', 1090, 112, 'db', [['alias_norm', 'PK'], ['lang', 'PK'], ['ingredient_id', 'FK'], ['source', 'off|model|manual (#167)', true], ['confidence', '0..1'], ['created_at', ''], ['off_release', 'planned #167', true]])
table('ingredients', 1090, 300, 'db', [['id', 'PK'], ['slug', 'UNIQUE'], ['fdc_id', 'FK'], ['fdc_match', 'exact|proxy'], ['category', 'FK'], ['density_g_per_ml', ''], ['merged_into', 'FK self']])
table('ingredient_portions', 1090, 500, 'db', [['ingredient_id', 'FK'], ['unit', ''], ['modifier', ''], ['grams', ''], ['source', 'fdc|category|community'], ['n_samples', '']])
table('ingredient_samples', 1090, 676, 'db', [['id', 'PK'], ['ingredient_id', 'FK'], ['owner_sub', ''], ['unit', ''], ['grams', ''], ['created_at', '']])
table('ingredient_categories', 1370, 112, 'db', [['id', 'PK'], ['name', 'UNIQUE'], ['categorical_modifier', ''], ['categorical_weighttograms', '']])
table('fdc_foods', 1370, 300, 'plain', [['fdc_id', 'PK'], ['data_type', 'sr_legacy|foundation'], ['description', ''], ['food_category', ''], ['search_text', 'trgm + fts'], ['release', '']])
table('fdc_portions', 1370, 500, 'plain', [['id', 'PK'], ['fdc_id', 'FK'], ['amount', ''], ['modifier', ''], ['measure_unit', ''], ['gram_weight', '']])

const t = tables
const L = 800, R = 1040, iL = 1090, iR = 1330, fL = 1370
const ingId = t.ingredients.row(0)
path(`M${L} ${t.canonization_queue.row(1)} H786 V${t.recipes.row(0)} H${L - 2}`)
path(`M${L} ${t.canonization_decisions.row(1)} H778 V${t.recipes.row(0) + 6} H${L - 2}`)
path(`M${R} ${t.canonization_decisions.row(9)} H1062 V${ingId} H${iL - 2}`)
path(`M${iL} ${t.ingredient_aliases.row(2)} H1074 V${ingId}`, { arrow: false })
path(`M${iL} ${t.ingredient_portions.row(0)} H1068 V${ingId}`, { arrow: false })
path(`M${iL} ${t.ingredient_samples.row(1)} H1056 V${ingId}`, { arrow: false })
path(`M${iR} ${t.ingredients.row(2)} H1350 V${t.fdc_foods.row(0)} H${fL - 2}`)
path(`M${iR} ${t.ingredients.row(4)} H1358 V${t.ingredient_categories.row(0)} H${fL - 2}`)
path(`M${iR} ${t.ingredients.row(6)} H1342 V${ingId + 6} H${iR + 2}`)
path(`M1490 ${t.fdc_portions.y} V${t.fdc_foods.y + t.fdc_foods.h + 2}`)
text(1500, 486, 'fdc_id', { size: 10.5, fill: C.muted })

text(1370, 700, 'FK arrows point at the referenced key.', { size: 11, fill: C.muted })
text(1370, 716, 'An alias collision (same alias_norm, lang,', { size: 11, fill: C.muted })
text(1370, 732, 'another ingredient) goes to review.', { size: 11, fill: C.muted })

// Legend.
const legend = [['db', 'deterministic / database'], ['model', 'local model (Ollama)'], ['plain', 'deterministic, no lookup · FDC tables'], ['person', 'needs a person'], ['plan', 'planned (#167)'], ['fail', 'failure path']]
legend.forEach(([k, label], i) => {
  rect(800, 836 + i * 16, 22, 11, C[k], { rx: 3, dash: k === 'plan' || k === 'fail' })
  text(830, 846 + i * 16, label, { size: 11.5, fill: C.muted })
})

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="930" viewBox="0 0 1640 930" font-family="system-ui,-apple-system,'Segoe UI',sans-serif">
<defs>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.line}"/></marker>
<marker id="f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.fail[1]}"/></marker>
</defs>
<rect width="1640" height="930" fill="#ffffff"/>
${out.join('\n')}
</svg>
`
writeFileSync(new URL('../docs/canonization.svg', import.meta.url), svg)
