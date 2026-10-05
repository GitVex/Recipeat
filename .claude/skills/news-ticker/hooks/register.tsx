import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Item } from '../types'

const FEEDS = [
  ['BBC', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['Guardian', 'https://www.theguardian.com/world/rss'],
  ['NPR', 'https://feeds.npr.org/1001/rss.xml'],
  ['tagesschau', 'https://www.tagesschau.de/index~rss2.xml'],
  ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
  ['DW', 'https://rss.dw.com/rdf/rss-en-all'],
  ['Euronews', 'https://www.euronews.com/rss'],
  ['Sky News', 'https://feeds.skynews.com/feeds/rss/world.xml'],
  ['CBC', 'https://www.cbc.ca/webfeed/rss/rss-topstories'],
  ['Global News', 'https://globalnews.ca/feed/'],
] as const
const SEP = '  •  '
const TICK_MS = 350
const REFRESH_MS = 10 * 60 * 1000
const MAX_AGE_MS = 6 * 60 * 60 * 1000
const PER_FEED = 4
const SEEN_KEPT = 500

// Every headline in ticker order; empty until the first fetch lands.
const items = atom({ plugin: 'news-ticker', key: 'items' } as const, [])
// Keys of headlines whose start has scrolled to the left edge; mirrored to $.store so they stay seen across sessions.
const seen = atom({ plugin: 'news-ticker', key: 'seen' } as const, [])
const offset = atom({ plugin: 'news-ticker', key: 'offset' } as const, 0)

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) =>
      String.fromCodePoint(/^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n)),
    )
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

// ponytail: regex RSS parsing (<pubDate>, or <dc:date> for DW's RDF); swap for a real parser if Atom feeds are added
export const itemsOf = (xml: string) =>
  [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)].map(([, body = '']) => ({
    title: decode(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    published: Date.parse(body.match(/<(?:pubDate|dc:date)>([\s\S]*?)<\//)?.[1] ?? ''),
  }))

export const ago = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

// One topic per line, `#` starts a comment. Matches whole words or phrases, any case.
export const topicsOf = (text: string) =>
  text
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map(t => new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu'))

export const isWanted = (title: string, allow: RegExp[], deny: RegExp[]) =>
  (allow.length === 0 || allow.some(t => t.test(title))) && !deny.some(t => t.test(title))

// An undated headline can't be judged, so it stays.
export const isRecent = (published: number, now: number) => Number.isNaN(published) || now - published <= MAX_AGE_MS

// Each headline's ticker text, its age worked out now rather than at fetch time.
export const segmentsOf = (list: readonly Item[], seenKeys: readonly string[], now: number) =>
  list.map(i => ({
    key: i.key,
    text: `${i.title} [${i.outlet}${i.published === null ? '' : `, ${ago(now - i.published)}`}]${SEP}`,
    fresh: !seenKeys.includes(i.key),
  }))

type Segment = ReturnType<typeof segmentsOf>[number]

// The `width` characters of the endless loop starting at `from`, split where freshness changes.
export const windowOf = (segs: readonly Segment[], from: number, width: number) => {
  const total = segs.reduce((n, s) => n + s.text.length, 0)
  const out: { text: string; fresh: boolean }[] = []
  let pos = from % total
  let i = 0
  // Indexes stay in range: pos < total, and i wraps with the modulo.
  while (pos >= segs[i]!.text.length) pos -= segs[i++]!.text.length
  for (let left = width; left > 0; i = (i + 1) % segs.length, pos = 0) {
    const seg = segs[i]!
    const text = seg.text.slice(pos, pos + left)
    left -= text.length
    const last = out.at(-1)
    if (last && last.fresh === seg.fresh) last.text += text
    else out.push({ text, fresh: seg.fresh })
  }
  return out
}

// The segment whose first character sits at `at`, if one does.
export const startingAt = (segs: readonly Segment[], at: number) => {
  let pos = 0
  for (const seg of segs) {
    if (pos === at) return seg
    pos += seg.text.length
  }
}

let timers: Timer[] = []

// Reads the lists, then starts the scroll and the feed refresh, replacing any earlier run.
async function start($: EngineInterface) {
  timers.forEach(t => t.cancel())
  // Editing either list reloads the plugin, so they're read once per load.
  const dir = $.plugin.root.replace(/[\\/]\.claude-plugin$/, '')
  const list = (name: string) => $.fs.read(`${dir}/${name}`).then(topicsOf, () => [])
  const [allow, deny] = await Promise.all([list('whitelist.txt'), list('blacklist.txt')])
  const stored = await $.store.get('seen')
  await update($, seen, () => (Array.isArray(stored) ? stored : []))

  const refresh = async () => {
    const now = await $.clock.now()
    const results = await Promise.all(
      FEEDS.map(([outlet, url]) =>
        $.http.fetch(url).then(
          r =>
            r.ok
              ? itemsOf(r.text)
                  .filter(i => i.title && isWanted(i.title, allow, deny) && isRecent(i.published, now))
                  .slice(0, PER_FEED)
                  .map(i => ({
                    key: `${outlet}|${i.title}`,
                    title: i.title,
                    outlet,
                    published: Number.isNaN(i.published) ? null : i.published,
                  }))
              : [],
          () => [],
        ),
      ),
    )
    // Interleave feeds so one source doesn't hog a stretch of the ticker.
    const fresh: Item[] = []
    for (let i = 0; i < PER_FEED; i++) for (const r of results) {
      const item = r[i]
      if (item) fresh.push(item)
    }
    if (fresh.length === 0) return
    await update($, items, () => fresh)
  }

  const tick = async () => {
    const list = await read($, items)
    if (list.length === 0) return
    const seenKeys = await read($, seen)
    const segs = segmentsOf(list, seenKeys, await $.clock.now())
    const total = segs.reduce((n, s) => n + s.text.length, 0)
    const at = ((await read($, offset)) + 1) % total
    await update($, offset, () => at)
    // A headline counts as seen once its start reaches the left edge: by then all of it has crossed the band.
    const reached = startingAt(segs, at)
    if (reached?.fresh) {
      const next = [...seenKeys, reached.key].slice(-SEEN_KEPT)
      await update($, seen, () => next)
      await $.store.set('seen', next)
    }
  }

  timers = [
    $.clock.every(TICK_MS, tick),
    $.clock.every(REFRESH_MS, refresh),
    // A timer, not a direct call: session.end aborts its own in-flight fetches after 1.5 s.
    $.clock.after(0, refresh),
  ]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await start($)
    return next(e)
  })

  // A /clear ends the session and starts no new session.start, so start over here.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') await start($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, items)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 2)
    const segs = segmentsOf(list, await read($, seen), await $.clock.now())
    const parts = windowOf(segs, await read($, offset), width)

    // "subtle" is the theme's faint gray; unseen headlines are the theme's yellow, dimmed toward the background.
    return (
      <Text color="subtle" wrap="truncate-end">
        {parts.map(p => (p.fresh ? <Text color="warning" dimColor>{p.text}</Text> : p.text))}
      </Text>
    )
  })
}
