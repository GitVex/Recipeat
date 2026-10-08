import { sql, type ColumnType, type Generated, type Insertable, type Selectable } from 'kysely'
import type { ExtractedRecipe } from '../extraction/recipe.ts'

/**
 * What Kysely knows about the tables in `migrations/`. Hand-written for now:
 * one table is cheaper to keep honest by reading than to generate. The moment
 * that stops being true — a second table, or the first migration that renames
 * a column — this is what `kysely-codegen` would produce from the database.
 *
 * `ColumnType<select, insert, update>` is how a column that reads back as
 * something other than it was written is described. NUMERIC is the one here:
 * it is arbitrary precision, so the driver hands it back as a string.
 */
export type RecipesTable = {
  id: Generated<string>
  owner_sub: string
  title: string | null
  source_lang: string
  portions: ColumnType<string | null, number | null, number | null>
  image: string | null
  total_time: number | null
  // JSONB reads back parsed, and is written as a cast string — see `json`
  // below for why it is not handed over as an object.
  ingredients: ColumnType<ExtractedRecipe['ingredients'], string, string>
  steps: ColumnType<ExtractedRecipe['steps'], string, string>
  source: ColumnType<ExtractedRecipe['source'], string, string>
  // Defaulted by a trigger to the row's own id, so it is never required.
  line_id: Generated<string>
  progression_of: string | null
  variant_of: string | null
  pinned: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type CollectionsTable = {
  id: Generated<string>
  owner_sub: string
  name: string
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

// One version in a collection — see 002_collections.sql.
export type CollectionRecipesTable = {
  collection_id: string
  recipe_id: string
  owner_sub: string
  position: number
  added_at: Generated<Date>
}

// A person's tags, and which lines wear them — see 003_tags.sql.
export type TagsTable = {
  id: Generated<string>
  owner_sub: string
  name: string
  created_at: Generated<Date>
}

export type RecipeTagsTable = {
  line_id: string
  tag_id: string
  owner_sub: string
  added_at: Generated<Date>
}

// One row per person who has saved a preference — see 004_preferences.sql.
// What `settings` may hold is the config's to say, not the table's.
export type PreferencesTable = {
  owner_sub: string
  settings: ColumnType<Record<string, unknown>, string, string>
  updated_at: Generated<Date>
}

// Photos of a dish, and the page a recipe was imported from — see
// 005_images.sql. BYTEA reads back as a Buffer and is written from one.
export type ImagesTable = {
  id: Generated<string>
  recipe_id: string
  owner_sub: string
  kind: 'dish' | 'source'
  position: number | null
  cover: Generated<boolean>
  media_type: ImageType
  data: Uint8Array
  thumb: Uint8Array
  created_at: Generated<Date>
}

export type ImageType = 'image/jpeg' | 'image/webp'

// The ingredient store — see 006_ingredients.sql. BIGINT reads back as a
// string, as NUMERIC does.
export type IngredientsTable = {
  id: ColumnType<string, never, never>
  density_g_per_ml: ColumnType<string | null, number | null, number | null>
  density_source: 'fdc' | 'searxng' | 'community' | null
  density_ref: string | null
  created_by: string | null
  created_at: Generated<Date>
}

export type IngredientSourcesTable = {
  ingredient_id: string
  source: 'off' | 'fdc'
  external_id: string
}

export type IngredientNamesTable = {
  ingredient_id: string
  lang: string
  name: string
  is_main: Generated<boolean>
  confirmed: boolean
  source: 'off' | 'cook' | 'searxng'
  added_by: string | null
  created_at: Generated<Date>
}

export type Database = {
  recipes: RecipesTable
  collections: CollectionsTable
  collection_recipes: CollectionRecipesTable
  tags: TagsTable
  recipe_tags: RecipeTagsTable
  preferences: PreferencesTable
  images: ImagesTable
  ingredients: IngredientsTable
  ingredient_sources: IngredientSourcesTable
  ingredient_names: IngredientNamesTable
}

export type RecipeRow = Selectable<RecipesTable>
export type NewRecipeRow = Insertable<RecipesTable>

/**
 * A value for an INSERT ... SELECT, cast to the type the column expects.
 *
 * Postgres resolves the types of a SELECT list on its own, before it knows
 * what the INSERT will do with them, so a bare parameter there is "could not
 * determine data type of parameter $1". Every literal below says what it is.
 */
export const text = (value: string | null) => sql<string | null>`${value}::text`
export const numeric = (value: number | null) => sql<string | null>`${value}::numeric`
export const integer = (value: number | null) => sql<number | null>`${value}::int`
export const boolean = (value: boolean) => sql<boolean>`${value}::boolean`
export const uuid = (value: string) => sql<string>`${value}::uuid`

/**
 * A document for a `jsonb` column: the value itself, cast.
 *
 * The cast is what makes the parameter's type `jsonb` rather than unknown, and
 * postgres.js then serializes it with its own jsonb serializer. Handing over
 * `JSON.stringify(value)` instead is the trap — the serializer encodes the
 * string it is given, the column ends up holding `"[{...}]"` rather than an
 * array, and the `jsonb_typeof` checks in 001_recipes.sql refuse the row.
 * Verified both ways against Postgres 17; the tests hold it.
 */
export const json = <T>(value: T) => sql<string>`${value}::jsonb`
