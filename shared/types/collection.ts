// A collection as the app and the server both see it (#46). Types only: the
// rules for a name live in server/collections/validate.ts.

export type Collection = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

// A recipe as a collection card shows it: the version that was added, not
// whatever its line has pinned since.
export type CollectionThumbnail = {
  id: string
  title: string | null
  image: string | null
}

// One entry in the listing: enough for a card and the header, with no second
// read per collection.
export type CollectionSummary = Collection & {
  count: number
  // The first four in the collection's order, fewer when it holds fewer.
  thumbnails: CollectionThumbnail[]
}
