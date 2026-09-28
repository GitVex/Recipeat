// Public surface of collections: a name checked on the way in, and the four
// writes and reads #68 needs. What is in a collection, and in what order, is
// #69.
export { MAX_COLLECTION_NAME, readCollectionName, validateCollectionName } from '../collections/validate.ts'
export { createCollection, deleteCollection, listCollections, renameCollection, type Collection, type CollectionSummary, type CollectionThumbnail } from '../collections/store.ts'
// A collection id is a table-generated UUID, as a recipe id is.
export { isRecipeId as isCollectionId } from '../recipes/id.ts'
