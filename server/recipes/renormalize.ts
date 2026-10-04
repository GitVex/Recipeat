import type { Sql } from 'postgres'
import type { RecipeRow } from '../database/schema.ts'
import { normalizeRecipe } from '../extraction/normalize.ts'
import { parseExtraction } from '../extraction/recipe.ts'
import { validateRecipe } from './validate.ts'

type Stored = Pick<RecipeRow, 'id' | 'title' | 'source_lang' | 'portions' | 'image' | 'total_time' | 'ingredients' | 'steps' | 'source'> & { stamp: string }

/**
 * Runs every stored recipe through the assembly a save runs, and writes back
 * the ingredients and steps that came out different: a key learned or an
 * alias gained since it was saved (#147), or one lost. The job #53 asks for,
 * and safe to run again — a second run finds nothing different.
 *
 * Not an edit: `updated_at` stays, and the line gets no new version. A row is
 * written only while `updated_at` is still what was read, so an edit a cook
 * saved meanwhile is kept, and that recipe is picked up by the next run.
 *
 * Answers with the number of recipes written.
 */
export async function renormalize(sql: Sql): Promise<number> {
  let written = 0
  // ponytail: reads every recipe, since a lost alias un-keys matched lines too.
  // Narrow it to recipes holding the names that changed if this grows slow.
  const rows = sql<Stored[]>`
    SELECT id, title, source_lang, portions, image, total_time, ingredients, steps, source,
           updated_at::text AS stamp
    FROM recipes
  `
  for await (const batch of rows.cursor(100)) {
    for (const row of batch) {
      let recipe
      try {
        const { draft, source } = validateRecipe({
          title: row.title, source_lang: row.source_lang,
          portions: row.portions === null ? null : Number(row.portions),
          image: row.image, totalTime: row.total_time,
          ingredients: row.ingredients, steps: row.steps, source: row.source,
        })
        recipe = normalizeRecipe(parseExtraction(draft, source))
      } catch (error) {
        // A row a save would refuse today stays as it is.
        console.warn(`[renormalize] recipe ${row.id} left as stored`, error)
        continue
      }
      const done = await sql.begin(async (tx) => {
        await tx`SELECT set_config('recipeat.renormalizing', 'on', true)`
        // Compared as jsonb, which ignores key order, so a recipe that comes
        // out the same is not written at all.
        return tx`
          UPDATE recipes SET ingredients = ${tx.json(recipe.ingredients)}, steps = ${tx.json(recipe.steps)}
          WHERE id = ${row.id} AND updated_at::text = ${row.stamp}
            AND (ingredients, steps) IS DISTINCT FROM (${tx.json(recipe.ingredients)}::jsonb, ${tx.json(recipe.steps)}::jsonb)
        `
      })
      written += done.count
    }
  }
  return written
}
