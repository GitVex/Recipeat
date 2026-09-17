// Public surface of the text extraction pipeline:
// readExtractionText -> extractText -> parseExtraction -> normalizeRecipe.
export { MAX_TEXT_LENGTH, readExtractionText, validateText } from '../extraction/text.ts'
export { askOllama, extractText, type OllamaConfig, type OllamaMessage } from '../extraction/ollama.ts'
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
