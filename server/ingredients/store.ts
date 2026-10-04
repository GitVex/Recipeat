import type { Sql } from 'postgres'
import type { FoodEntry } from '../extraction/ingredients.ts'

/** Every active key with its names, as the matcher's snapshot holds them. */
export async function readFoods(sql: Sql): Promise<FoodEntry[]> {
  return sql<FoodEntry[]>`
    SELECT i.key, i.form, i.grams_per_ml AS "gramsPerMl",
           coalesce(array_agg(n.name ORDER BY n.position) FILTER (WHERE n.lang = 'en'), '{}') AS en,
           coalesce(array_agg(n.name ORDER BY n.position) FILTER (WHERE n.lang = 'de'), '{}') AS de
    FROM ingredients i LEFT JOIN ingredient_names n ON n.key = i.key
    GROUP BY i.key
    ORDER BY i.key
  `
}
