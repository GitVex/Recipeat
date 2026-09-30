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
  | { type: 'instagram', url: string, author: string | null, retrievedAt: string }

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
  // The line's, not this version's: every version of a recipe wears the same
  // set, A to Z. Written on their own, never with the recipe (#13).
  tags: string[]
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
export type RecipeSummary = Pick<SavedRecipe, 'id' | 'lineId' | 'title' | 'image' | 'totalTime' | 'portions' | 'tags' | 'createdAt' | 'updatedAt'> & {
  ingredientCount: number
  stepCount: number
}

// What a deletion took, or would take. `ids` is the version asked for and
// every progression descended from it; `pinned` is the version the surviving
// line is entered by afterwards — its parent when the pin was among them —
// and null when the line ended with it.
export type RecipeDeletion = {
  count: number
  ids: string[]
  pinned: string | null
}

// A few words either side of what changed in a line of text. `removed` and
// `added` are the words that differ; `before` and `after` are unchanged
// context, and start or end with an ellipsis where they were cut.
export type Snippet = { before: string, removed: string, added: string, after: string }

// One ingredient that differs from the original: by name, since ids are
// positional. A change is to its amount — with the difference where the
// units allow one — or, when the amount is the same, to its wording.
export type IngredientChange =
  | { kind: 'added' | 'removed', name: string, text: string }
  | {
    kind: 'changed'
    name: string
    amount: { from: string | null, to: string | null, by: string | null } | null
    snippet: Snippet | null
  }

// One step that differs, by its number: in the newer version, or for a
// removed one, where it stood in the original.
export type StepChange = { kind: 'added' | 'removed' | 'changed', number: number, snippet: Snippet }

type Changed<T> = { added: number, removed: number, changed: number, items: T[] }

// What changed between two versions. `portions` and `totalTime` are
// [before, after] when they differ. The counts are whole; `items` stops at a
// dozen, so a version rewritten end to end does not carry itself along.
export type RecipeChanges = {
  title: boolean
  portions: [number | null, number | null] | null
  totalTime: [number | null, number | null] | null
  ingredients: Changed<IngredientChange>
  steps: Changed<StepChange>
}

// One version in a line, as its history lists it: enough to tell it apart and
// to open it, and not the recipe itself. A line of thirty is thirty of these,
// and reading one of them in full is the detail route's job. `changes` is
// how it differs from the original of its line, and null on the original.
export type RecipeVersion = Pick<SavedRecipe, 'id' | 'title' | 'progressionOf' | 'pinned' | 'createdAt' | 'updatedAt'> & {
  ingredientCount: number
  stepCount: number
  changes: RecipeChanges | null
}

// A recipe that branched off a version in the line, shown by its entry point
// and nothing more: its own history is its own business. `variantOf` is the
// version in this line it came from.
export type RecipeBranch = Pick<SavedRecipe, 'id' | 'title' | 'createdAt'> & {
  variantOf: string
}

// Everything a history view draws: the line's versions, oldest first, for the
// tree; what branched off them; and what the line itself branched off, while
// that still exists.
export type RecipeHistory = {
  lineId: string
  versions: RecipeVersion[]
  variants: RecipeBranch[]
  origin: Pick<SavedRecipe, 'id' | 'title'> | null
}
