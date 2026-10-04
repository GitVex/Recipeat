import type { RecipeSummary, SavedRecipe } from "#shared/types/recipe";
import { filtersToQuery, hasFilters, type RecipeFilters } from "#shared/utils/recipeFilters";

// The collection as GET /api/recipes answers it: one entry per line, the
// pinned version, newest first. One key, so the collection page, the header's
// count and the import flow all read and write the same copy.
const KEY = "recipes";

// A filtered listing (#14) is a copy of its own, keyed by its query, so the
// header's count and the profile's are always of every recipe. Which one the
// collection page is showing is kept here, for the writes below to find it.
const SHOWN = "recipe-list-shown";

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

// `defer`: a second read of the same key while one is on its way waits for
// it, rather than cancelling it and asking again. The collection page reads
// this key twice when nothing is filtered — see below.
export function useRecipeList() {
  return useFetch<Listing>("/api/recipes", { key: KEY, retry: 0, dedupe: "defer" });
}

/**
 * The listing narrowed by `filters`, read again whenever they change. With
 * none set it is the one above, under its key. The filtering is the server's:
 * nothing is fetched whole to be sifted here.
 *
 * The whole listing is held as well, for the header's count. Without that,
 * moving to a filtered key would leave the whole listing with nothing holding
 * it, and Nuxt would drop it. With no filters the two are one request.
 */
export function useFilteredRecipeList(filters: Ref<RecipeFilters>) {
  useRecipeList();
  const query = computed(() => filtersToQuery(filters.value));
  const key = computed(() =>
    hasFilters(filters.value) ? `${KEY}:${JSON.stringify(query.value)}` : KEY,
  );
  const shown = useState<string>(SHOWN, () => KEY);
  shown.value = key.value;
  watch(key, (value) => (shown.value = value));
  return useFetch<Listing>("/api/recipes", { key, query, retry: 0, dedupe: "defer" });
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
 * A filtered listing on screen is read again instead of patched: whether a
 * recipe still matches after it changed is the server's question. `relist`
 * reads both again, for a change that moves a pin.
 *
 * Call it in setup: it needs the Nuxt app, which an awaited handler no longer
 * has.
 */
export function useRecipeListCache() {
  const { data } = useNuxtData<Listing>(KEY);
  const shown = useState<string>(SHOWN, () => KEY);
  const filtered = () => (shown.value === KEY ? [] : [shown.value]);
  const relist = () => refreshNuxtData([KEY, ...filtered()]);
  // A new recipe is not in a filtered view until the filters are changed:
  // appearing in one it might not match would be the wrong answer.
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
    if (filtered().length) void refreshNuxtData(filtered());
    if (!data.value) return;
    data.value = {
      // The card's picture stays: a save does not touch photos, and the
      // listing's choice of cover is not in the recipe.
      recipes: data.value.recipes.map((entry) =>
        entry.id === recipe.id ? { ...entry, ...summaryOf(recipe), image: entry.image } : entry,
      ),
    };
  }
  // Tags belong to a line, so whichever version was tagged, the entry that
  // shows its line wears them.
  function retag(lineId: string, tags: string[]) {
    if (filtered().length) void refreshNuxtData(filtered());
    if (!data.value) return;
    data.value = {
      recipes: data.value.recipes.map((entry) =>
        entry.lineId === lineId ? { ...entry, tags } : entry,
      ),
    };
  }
  return { data, add, update, retag, relist };
}

// The entries the collection page is showing, filtered or not: provided by
// the page, for the preview beside it.
export const SHOWN_RECIPES: InjectionKey<Ref<RecipeSummary[]>> = Symbol("shown-recipes");

/**
 * The entry the collection's preview shows. Set by hover and by focus, and
 * left where it was when the pointer leaves, so that moving towards the
 * preview does not empty it. Until anything is highlighted, the newest of
 * `recipes` — the ones on screen, so a filter never previews one it hid.
 */
export function useHighlightedRecipe(recipes: Ref<RecipeSummary[]>) {
  const id = useState<string | null>("collection-highlight", () => null);
  const current = computed(
    () => recipes.value.find((recipe) => recipe.id === id.value) ?? recipes.value[0] ?? null,
  );
  return { id, current };
}

/**
 * Whole recipes already read, by id. The preview fills it, so a recipe opened
 * from the preview is on screen at once while its own read catches up.
 */
export const useRecipeCache = () =>
  useState<Record<string, SavedRecipe>>("recipe-cache", () => ({}));
