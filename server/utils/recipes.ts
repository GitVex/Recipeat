// Public surface of the storage path: validate what a browser sends, rebuild
// it with the same assembly extraction uses, write it, read it back.
// read -> validateRecipe -> parseExtraction -> normalizeRecipe -> a write
//
// The five writes differ only in what they do to a line. insertRecipe starts
// one, updateRecipe corrects a version in place, insertProgression extends a
// line and takes its pin, insertVariant leaves the line for one of its own,
// deleteRecipe prunes a line and hands the pin back up it.
export { readRecipeBody, validateRecipe, type ValidatedDraft } from '../recipes/validate.ts'
export { deleteRecipe, findRecipe, insertProgression, insertRecipe, insertVariant, listRecipes, updateRecipe, type RecipeDeletion, type RecipeSummary, type SavedRecipe } from '../recipes/store.ts'
export { isRecipeId } from '../recipes/id.ts'
export { requireOwnerSub } from '../recipes/owner.ts'
