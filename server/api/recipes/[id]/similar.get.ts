import { allowSearch, searchQuery, searchWeb, similarTo } from '../../../recipes/similar.ts'
import { requireDatabase } from '../../../utils/database.ts'
import { findRecipe, isRecipeId, requireOwnerSub } from '../../../utils/recipes.ts'

// Per title and language rather than per recipe, so every version of a
// carbonara shares one search. A failure is not cached.
const cachedSearch = defineCachedFunction(
  (query: string, lang: string, searxngBaseUrl: string) => searchWeb(query, lang, { searxngBaseUrl }),
  { name: 'similar-recipes', maxAge: 60 * 60 * 24, getKey: (query: string, lang: string) => `${lang}:${query.toLowerCase()}` },
)

// Three links to similar recipes on the web. Takes a recipe id rather than
// text, so the search is always for one of the caller's own recipes.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not a recipe id.' })

  const recipe = await findRecipe(requireDatabase(), ownerSub, id)
  if (!recipe) throw createError({ statusCode: 404, message: 'No such recipe.' })
  if (!recipe.title?.trim()) return { results: [] }

  if (!allowSearch(ownerSub)) throw createError({ statusCode: 429, message: 'Too many searches. Try again later.' })

  const found = await cachedSearch(searchQuery(recipe.title.trim(), recipe.source_lang), recipe.source_lang, useRuntimeConfig(event).searxngBaseUrl)
  const source = recipe.source.type === 'website' ? recipe.source : null
  return { results: similarTo(found, [source?.url, source?.post?.url]) }
})
