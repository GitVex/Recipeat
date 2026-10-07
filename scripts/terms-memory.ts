// The llama-server OOM (#159): sends each batch of search-terms.ts twice, with
// and without `format`, and prints when each call ran, to line up with the
// Ollama container's anonymous memory sampled on its host:
//
//   c=$(docker ps -qf name=ollama | head -1)
//   docker exec "$c" sh -c 'while :; do echo "$(date +%s.%N) $(grep "^anon " /sys/fs/cgroup/memory.stat)"; sleep 0.2; done' > anon.log
//
//   node --experimental-strip-types scripts/terms-memory.ts [url] [langs] > calls.log
//   node --experimental-strip-types scripts/terms-memory.ts --join calls.log anon.log
//
// The request is the one searchTerms builds, caught by a fetcher that never
// sends it, so the prompt and grammar are exactly the client's.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { searchTerms } from '../server/ingredients/terms.ts'

if (process.argv[2] === '--join') {
  const calls = readFileSync(process.argv[3]!, 'utf8').trim().split('\n').map(l => l.split(' '))
  const samples = readFileSync(process.argv[4]!, 'utf8').trim().split('\n')
    .map(l => l.split(' ')).filter(p => p[1] === 'anon').map(([t, , b]) => [+t!, +b!] as const)
  const peaks: Record<string, number[]> = {}
  for (const [mode, lang, i, start, end, status] of calls) {
    const peak = Math.max(0, ...samples.filter(([t]) => t >= +start! && t <= +end!).map(([, b]) => b))
    ;(peaks[mode!] ??= []).push(peak)
    console.log(mode, lang, i, `${(+end! - +start!).toFixed(1)}s`, status, `peak anon ${(peak / 2 ** 30).toFixed(2)} GiB`)
  }
  for (const [mode, list] of Object.entries(peaks)) {
    const sorted = list.sort((a, b) => a - b), gib = (n: number) => (n / 2 ** 30).toFixed(2)
    console.log(`${mode}: ${list.length} calls, median ${gib(sorted[sorted.length >> 1]!)} GiB, max ${gib(sorted.at(-1)!)} GiB`)
  }
  process.exit(0)
}

const [url = 'http://127.0.0.1:8101', langs = 'ar,ko'] = process.argv.slice(2)
type Entry = { key: string, fdcId: number | null } & Record<string, string[]>
const entries = (JSON.parse(execSync('git show ad28389:server/extraction/ingredients.json', { encoding: 'utf8', maxBuffer: 1 << 24 })) as Entry[])
  .filter(e => e.fdcId)
const { _: columns, ...more } = JSON.parse(readFileSync(new URL('./search-terms.names.json', import.meta.url), 'utf8')) as Record<string, string[]>
for (const e of entries) columns!.forEach((lang, i) => { const name = more[e.key]?.[i]; e[lang] = name ? [name] : [] })

const request = async (names: string[], lang: string) => {
  let body = ''
  await searchTerms(names, lang, { ollamaBaseUrl: url, ollamaModel: 'qwen3.5:4b', ollamaThreads: 4 }, async (_, init) => {
    body = String(init!.body)
    throw new Error('caught')
  }).catch(() => {})
  return JSON.parse(body) as Record<string, unknown>
}

for (const lang of langs.split(',')) {
  const names = entries.map(e => e[lang]?.[0]).filter((n): n is string => !!n)
  for (let i = 0; i < names.length; i += 10) {
    const withFormat = await request(names.slice(i, i + 10), lang)
    const { format: _, ...without } = withFormat
    for (const [mode, body] of [['format', withFormat], ['none', without]] as const) {
      const start = Date.now() / 1000
      const status = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.text().then(() => String(r.status)), (e: Error) => e.message.replaceAll(' ', '_'))
      console.log(mode, lang, i, start.toFixed(2), (Date.now() / 1000).toFixed(2), status)
    }
  }
}
