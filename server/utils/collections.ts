// Public surface of collections: what a request may send, checked on the way
// in, and what the routes do with it — the collections themselves (#68), and
// which versions are in each, in what order (#69).
export { MAX_COLLECTION_NAME, MAX_COLLECTION_ORDER, readCollectionName, readCollectionOrder, validateCollectionName, validateCollectionOrder } from '../collections/validate.ts'
export { addToCollection, collectionsContaining, createCollection, deleteCollection, listCollections, readCollection, removeFromCollection, renameCollection, reorderCollection, type Collection, type CollectionDetail, type CollectionEntry, type CollectionSummary, type CollectionThumbnail } from '../collections/store.ts'
// A collection id is a table-generated UUID, as a recipe id is.
export { isRecipeId as isCollectionId } from '../recipes/id.ts'
