// The one shape of a recipe, for the app and the server alike. Extraction
// produces an ExtractedRecipe, storage adds what the table knows about it, and
// the app renders either without translating. Types only: the rules that
// build and check these live on the server, in server/extraction/recipe.ts.

export type Unit =
  | 'g' | 'kg' | 'mg' | 'oz' | 'lb'
  | 'ml' | 'l' | 'cup_us' | 'cup_metric' | 'tbsp_us' | 'tbsp_metric' | 'tbsp_au'
  | 'tsp_us' | 'tsp_metric' | 'fl_oz_us' | 'fl_oz_imperial'
  | 'celsius' | 'fahrenheit'
  | 'second' | 'minute' | 'hour'
  | 'mm' | 'cm' | 'inch'
  | 'count'
  // Regionally ambiguous as written; resolved for display, not at extraction.
  | 'cup' | 'tbsp' | 'tsp' | 'fl_oz'

export type QuantityKind = 'mass' | 'volume' | 'count' | 'temperature' | 'duration' | 'length' | 'other'

export type Quantity = { value: number, maxValue: number | null, unit: Unit | null }

export type Ingredient = {
  id: string
  originalText: string
  name: string
  // The model's segmentation, kept so the parser can be rerun without it.
  quantityText: string | null
  quantity: Quantity | null
  // "finely diced", "for the sauce" — the rest of the line, for display
  // beside the name. Null where the source segmented nothing out.
  extra: string | null
}

export type StepPart =
  | { type: 'text', value: string }
  // Keys into the step's own quantities.
  | { type: 'measurement', quantity: string }
  // Points at an ingredient whose full amount this step restates.
  | { type: 'ingredientQuantity', ingredientId: string }

export type StepQuantity = Quantity & { kind: QuantityKind, scaleWithPortions: boolean | null }

export type Step = {
  id: string
  originalText: string
  parts: StepPart[]
  quantities: Record<string, StepQuantity>
}

// Only the modality that ran the extraction knows where it came from, so each
// one builds this itself and hands it to parseExtraction.
export type RecipeSource =
  | { type: 'text', originalText: string }
  | { type: 'website', url: string, author: string | null, siteName: string | null, retrievedAt: string }
  // objectKey is null until object storage lands: the photo is read and
  // thrown away, so there is nothing yet to point at. See docs/planning.md.
  | { type: 'photo', objectKey: string | null, originalFilename: string | null }

export type ExtractedRecipe = {
  title: string | null
  source_lang: string
  portions: number | null
  // A picture of the dish, and how long it takes end to end. The image comes
  // from a page's own metadata and is null for every other source, for now;
  // totalTime is whatever the source states, on all three paths.
  image: string | null
  totalTime: number | null
  ingredients: Ingredient[]
  steps: Step[]
  source: RecipeSource
}

// A saved recipe is an extracted one plus what the table knows about it: which
// row it is, when it was written, and where it sits in its line. The lineage
// fields are read-only here — #29 owns the writes that move them.
export type SavedRecipe = ExtractedRecipe & {
  id: string
  lineId: string
  progressionOf: string | null
  variantOf: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

// What a collection card needs and no more. The rows carry whole recipes in
// JSONB, and a listing that returns fifty of them to render fifty titles is
// paying for the detail route twice.
export type RecipeSummary = Pick<SavedRecipe, 'id' | 'title' | 'image' | 'totalTime' | 'portions' | 'createdAt' | 'updatedAt'> & {
  ingredientCount: number
  stepCount: number
}
