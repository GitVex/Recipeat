import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

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
]
const SEP = '  •  '
const TICK_MS = 350
const REFRESH_MS = 10 * 60 * 1000
const PER_FEED = 4

// Every headline joined into one loop of text; empty until the first fetch lands.
const strip = atom({ plugin: 'news-ticker', key: 'strip' } as const, '')
const offset = atom({ plugin: 'news-ticker', key: 'offset' } as const, 0)

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

// ponytail: regex RSS parsing, first PER_FEED <item> titles per feed; swap for a real parser if Atom feeds are added
export const titlesOf = (xml: string) =>
  [...xml.matchAll(/<item[\s>][\s\S]*?<title>([\s\S]*?)<\/title>/g)].slice(0, PER_FEED).map(m => decode(m[1]))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const refresh = async () => {
      const results = await Promise.all(
        FEEDS.map(([outlet, url]) =>
          $.http.fetch(url).then(r => (r.ok ? titlesOf(r.text).map(t => `${t} [${outlet}]`) : []), () => []),
        ),
      )
      // Interleave feeds so one source doesn't hog a stretch of the ticker.
      const fresh: string[] = []
      for (let i = 0; i < PER_FEED; i++) for (const r of results) if (r[i]) fresh.push(r[i])
      if (fresh.length === 0) return
      await update($, strip, () => [...new Set(fresh)].join(SEP) + SEP)
    }

    $.clock.every(TICK_MS, async () => {
      const text = await read($, strip)
      if (text) await update($, offset, o => (o + 1) % text.length)
    })
    $.clock.every(REFRESH_MS, refresh)
    void refresh()

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, strip)
    if (e.props.hasSurvey || !text) return next(e)

    const { Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 2)
    const from = await read($, offset)
    const loop = text.repeat(Math.ceil((from + width) / text.length) + 1)

    // The theme's "subtle" key: a faint gray that sits close to the background in every theme.
    return (
      <Text color="subtle" wrap="truncate-end">
        {loop.slice(from, from + width)}
      </Text>
    )
  })
}
