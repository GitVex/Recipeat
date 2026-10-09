// The recipe address in a prefix link (#136), `/get/<url>`: everything after
// `/get/` in the raw address, its own query and fragment included, since read
// through the router those would be Recipeat's. A proxy or a browser may fold
// the `//` after the scheme into one, so that is put back, and an address that
// arrived percent-encoded whole is decoded. Anything else is refused with the
// reason the import dialog shows, rather than handed to the fetcher.
export const NOT_A_WEB_LINK =
  'Recipeat was sent a link it can’t read: only http and https web addresses can be brought in.'

export function importLink(raw: string): { url: string; error: string } {
  let address = raw.trim()
  if (!address) return { url: '', error: '' }
  if (/^https?%3A/i.test(address)) {
    try {
      address = decodeURIComponent(address)
    } catch {}
  }
  address = address.replace(/^(https?):\/*/i, '$1://')
  try {
    const url = new URL(address)
    if (url.protocol === 'http:' || url.protocol === 'https:') return { url: address, error: '' }
  } catch {}
  return { url: '', error: NOT_A_WEB_LINK }
}
