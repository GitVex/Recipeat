import type { SavedRecipe } from "#shared/types/recipe";
import type { TagSummary } from "#shared/types/tag";

// The owner's tags as GET /api/tags answers them: every tag some recipe
// wears, A to Z, with how many. One key, so the editor's suggestions and the
// filter read the same copy.
const KEY = "tags";

type Listing = { tags: TagSummary[] };

export function useTagList() {
  return useFetch<Listing>("/api/tags", { key: KEY, retry: 0 });
}

// What a set of tags the server refused means to a person.
export const tagsProblem = (status: number | undefined) =>
  status === 413
    ? "That’s too much. A tag is up to 40 characters, and a recipe has up to 20."
    : status === 400
      ? "A tag is a word or two on one line."
      : status === 401
        ? "Your session ended. Sign in again to change your tags."
        : status === 404
          ? "This recipe is gone. It may have been deleted."
          : "That didn’t work. Try again.";

/**
 * Setting a recipe's tags, with every copy that shows them kept in step: the
 * recipe itself wherever it is cached, its entry in the list, and the list of
 * tags. The list entry is found by line, since the version tagged need not be
 * the one the list shows. Throws what `$fetch` threw.
 *
 * Call it in setup.
 */
export function useTagWrites() {
  const cache = useRecipeCache();
  const list = useRecipeListCache();
  const { data: tagList } = useNuxtData<Listing>(KEY);

  async function set(recipe: SavedRecipe, tags: string[]): Promise<string[]> {
    const { tags: stored } = await $fetch<{ tags: string[] }>(`/api/recipes/${recipe.id}/tags`, {
      method: "PUT",
      body: { tags },
      retry: 0,
    });
    // Every version of the line wears them; the cache holds any of them.
    const updated = Object.fromEntries(
      Object.entries(cache.value).map(([id, cached]) => [
        id,
        cached.lineId === recipe.lineId ? { ...cached, tags: stored } : cached,
      ]),
    );
    cache.value = updated;
    list.retag(recipe.lineId, stored);
    // Counts move and names come and go; the server knows which.
    if (tagList.value) {
      try {
        tagList.value = await $fetch<Listing>("/api/tags", { retry: 0 });
      } catch {
        // Suggestions a moment out of date are not worth an error.
      }
    }
    return stored;
  }
  return { set };
}
