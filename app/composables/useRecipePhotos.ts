import type { RecipePhotos } from "#shared/types/recipe";

// A version's photos (#45), read once for the page and the photo strip: one
// key, so a change made in the strip reaches the banner (#193).
export const useRecipePhotos = (recipeId: string) =>
  useFetch<RecipePhotos>(`/api/recipes/${recipeId}/photos`, {
    key: `photos:${recipeId}`,
    retry: 0,
  });
