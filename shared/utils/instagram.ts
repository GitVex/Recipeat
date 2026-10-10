// What counts as a link to one Instagram post, in one place: the import dialog
// uses it to send the link to the Instagram route, and the route to refuse
// anything else. instagram.com/p/…, /reel/…, /tv/…, and the /{user}/p/… a share
// can produce. Only the shortcode goes on to the fetcher, which is what keeps
// the caller from naming any other host.
const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const POST_PATH = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,64})\/?$/

/** The shortcode of an Instagram post link, or null for anything else. */
export function instagramShortcode(address: unknown): string | null {
  if (typeof address !== 'string') return null
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return HOSTS.has(url.hostname) ? POST_PATH.exec(url.pathname)?.[1] ?? null : null
}

// What the import dialog's check (#219) says a post's caption holds: a link
// to the recipe, the recipe itself, or neither: then a reel is read from its
// sound (#124), and any other post from its images.
export type CaptionVerdict = 'link' | 'caption' | 'audio' | 'images'

export const CAPTION_HINT: Record<CaptionVerdict, string> = {
  link: 'Instagram post recognised. Its caption links to a recipe page, which we’ll read first.',
  caption: 'Instagram post recognised. The recipe looks to be in its caption, so we’ll read it from there.',
  audio: 'Instagram post recognised. Its caption doesn’t seem to hold the recipe, so we’ll listen to the reel: recipes said aloud can be read from its sound. Reels up to 3 minutes.',
  images: 'Instagram post recognised. Its caption doesn’t seem to hold the recipe, so we’ll read the post’s images with it.',
}
