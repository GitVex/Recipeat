// Public surface of images (#45): an upload checked on the way in, a version's
// photos added, arranged and removed, the line's source photo kept, and the
// bytes read back for their owner only.
export { readImageUpload } from '../images/upload.ts'
export { addPhoto, arrangePhotos, deleteImage, listPhotos, MAX_PHOTOS, readImage, setSourcePhoto, type RecipePhotos } from '../images/store.ts'
