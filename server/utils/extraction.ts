// Public surface of the extraction pipeline. Each modality reads its own
// input and builds its own messages; validation and normalization are shared:
// read -> extract -> parseExtraction -> normalizeRecipe.
export { MAX_TEXT_LENGTH, readExtractionText, validateText } from '../extraction/text.ts'
export { askOllama, extractText, SYSTEM_PROMPT, type OllamaConfig, type OllamaMessage } from '../extraction/ollama.ts'
export { extractPhoto, MAX_PHOTO_BYTES, readExtractionPhoto, type OcrConfig, type Photo } from '../extraction/photo.ts'
export { extractWebsite, readExtractionUrl, validateUrl, type FetcherConfig } from '../extraction/website.ts'
// The replacements for the `ollama.ts` and `photo.ts` lines above, standing
// alongside rather than over the top while both are measurable. Gemini reads a
// photograph itself, so
// its photo path needs no OCR service and no layout of ours; its text path
// differs from Ollama's only in transport. The `ViaGemini` names exist so the
// two can be compared in one process — when Ollama and the OCR service go, the
// aliases go with them and these become `extractText` and `extractPhoto`.
export {
  askGemini,
  extractPhoto as extractPhotoViaGemini,
  extractText as extractTextViaGemini,
  PHOTO_PROMPT,
  SYSTEM_PROMPT as GEMINI_SYSTEM_PROMPT,
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
