// What an image upload may be (#45), shared so the browser makes what the
// server takes. The byte ceilings are the table's CHECKs in 005_images.sql.
export const MAX_PHOTOS = 10
export const MAX_IMAGE_BYTES = 1_500_000
export const MAX_THUMB_BYTES = 150_000

// Where an image is read from: the only address the app ever links to, so
// moving the bytes out of Postgres later changes no link.
export const imageUrl = (id: string, size: 'full' | 'thumb' = 'full') =>
  size === 'thumb' ? `/api/images/${id}?size=thumb` : `/api/images/${id}`
