import type { RecipeSummary, SavedRecipe } from "#shared/types/recipe";

// The collection as GET /api/recipes answers it: one entry per line, the
// pinned version, newest first. One key, so the collection page, the header's
// count and the import flow all read and write the same copy.
const KEY = "recipes";

type Listing = { recipes: RecipeSummary[] };

// What a failed read means to a person. 401 is its own state rather than an
// error: a session that ran out is the same page as never having signed in.
export type ListFailure = "signedOut" | "unavailable" | "failed";

export function failureOf(status: number | undefined): ListFailure {
  if (status === 401) return "signedOut";
  // No database on this deployment. Nothing a retry will change.
  if (status === 503) return "unavailable";
  return "failed";
}

export function useRecipeList() {
  return useFetch<Listing>("/api/recipes", { key: KEY, retry: 0 });
}

// The card fields of a recipe already in hand, so a new one can join the list
// without the list being read again.
export const summaryOf = (recipe: SavedRecipe): RecipeSummary => ({
  id: recipe.id,
  lineId: recipe.lineId,
  title: recipe.title,
  image: recipe.image,
  totalTime: recipe.totalTime,
  portions: recipe.portions,
  tags: recipe.tags,
  ingredientCount: recipe.ingredients.length,
  stepCount: recipe.steps.length,
  createdAt: recipe.createdAt,
  updatedAt: recipe.updatedAt,
});

/**
 * The cached listing, for reading it without fetching it — the header shows a
 * count only once something has asked for the list. `add` puts a recipe just
 * written at the top, where the listing would put it, and `update` replaces
 * one saved over where it stands. If the list was never
 * loaded there is nothing to update: the first read will include it.
 *
 * Call it in setup: it needs the Nuxt app, which an awaited handler no longer
 * has.
 */
export function useRecipeListCache() {
  const { data } = useNuxtData<Listing>(KEY);
  function add(recipe: SavedRecipe) {
    if (!data.value) return;
    data.value = {
      recipes: [
        summaryOf(recipe),
        ...data.value.recipes.filter((entry) => entry.id !== recipe.id),
      ],
    };
  }
  // A recipe saved over keeps its place: the listing is ordered by when a
  // line was started, not when it was last written.
  function update(recipe: SavedRecipe) {
    if (!data.value) return;
    data.value = {
      recipes: data.value.recipes.map((entry) =>
        entry.id === recipe.id ? summaryOf(recipe) : entry,
      ),
    };
  }
  // Tags belong to a line, so whichever version was tagged, the entry that
  // shows its line wears them.
  function retag(lineId: string, tags: string[]) {
    if (!data.value) return;
    data.value = {
      recipes: data.value.recipes.map((entry) =>
        entry.lineId === lineId ? { ...entry, tags } : entry,
      ),
    };
  }
  return { data, add, update, retag };
}

/**
 * The entry the collection's preview shows. Set by hover and by focus, and
 * left where it was when the pointer leaves, so that moving towards the
 * preview does not empty it. Until anything is highlighted, the newest.
 */
export function useHighlightedRecipe() {
  const { data } = useRecipeListCache();
  const id = useState<string | null>("collection-highlight", () => null);
  const current = computed(() => {
    const recipes = data.value?.recipes ?? [];
    return recipes.find((recipe) => recipe.id === id.value) ?? recipes[0] ?? null;
  });
  return { id, current };
}

/**
 * Whole recipes already read, by id. The preview fills it, so a recipe opened
 * from the preview is on screen at once while its own read catches up.
 */
export const useRecipeCache = () =>
  useState<Record<string, SavedRecipe>>("recipe-cache", () => ({}));
