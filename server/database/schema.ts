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

export type Database = {
  recipes: RecipesTable
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
