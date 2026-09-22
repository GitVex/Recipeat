// Public surface of the extraction pipeline. Each modality reads its own
// input and builds its own messages; validation and normalization are shared:
// read -> extract -> parseExtraction -> normalizeRecipe.
export { MAX_TEXT_LENGTH, readExtractionText, validateText } from '../extraction/text.ts'
export { MAX_PHOTO_BYTES, readExtractionPhoto, type Photo } from '../extraction/photo.ts'
export { extractWebsite, readExtractionUrl, validateUrl, type FetcherConfig } from '../extraction/website.ts'
// Both model-backed modalities. The photo path sends the photograph itself, so
// there is no reading step between the page and the recipe and nothing that has
// to decide the page's layout first.
export {
  askGemini,
  extractPhoto,
  extractText,
  PHOTO_PROMPT,
  SYSTEM_PROMPT,
  type GeminiConfig,
  type Part,
} from '../extraction/gemini.ts'
export { httpUrl, MAX_URL_LENGTH } from '../extraction/url.ts'
export { normalizeRecipe } from '../extraction/normalize.ts'
export { isUnit, kindOf, parseQuantity, unitInfo } from '../extraction/quantity.ts'
export {
  parseExtraction,
  type ExtractedRecipe,
  type Ingredient,
  type IngredientDraft,
  type Quantity,
  type QuantityKind,
  type RecipeDraft,
  type RecipeSource,
  type Step,
  type StepPart,
  type StepQuantity,
  type Unit,
} from '../extraction/recipe.ts'
