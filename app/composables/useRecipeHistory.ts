import type { RecipeHistory, SavedRecipe } from "#shared/types/recipe";

// A recipe's own history (#31): the line it belongs to, read once the page is
// up, and the pin moved along it. Read in the browser only and never waited
// for — nearly every recipe has no history, and the page does not hold up its
// recipe to find that out.

type Failure = { statusCode?: number };

function pinMessage(error: unknown): string {
  switch ((error as Failure).statusCode) {
    case undefined:
      return "We couldn’t reach Recipeat. Check your connection and try again.";
    case 401:
      return "You’ve been signed out. Sign in again to pin a version.";
    case 404:
      return "That version isn’t there any more.";
    case 409:
      return "This recipe changed while it was being pinned. Nothing moved; try again.";
    default:
      return "Something went wrong, and the pin stayed where it was.";
  }
}

export const historyKey = (id: string) => `recipe-history:${id}`;

export function useRecipeHistory(id: string) {
  const request = useFetch<{ history: RecipeHistory }>(`/api/recipes/${id}/history`, {
    key: historyKey(id),
    retry: 0,
    server: false,
    lazy: true,
  });
  const history = computed(() => request.data.value?.history ?? null);
  const tree = computed(() => (history.value ? historyTree(history.value) : null));
  // The version the collection shows, once the line has been read.
  const pinnedId = computed(
    () => history.value?.versions.find((version) => version.pinned)?.id ?? null,
  );

  const cache = useRecipeCache();
  const { notify } = useToast();
  const pinning = ref<string | null>(null);
  const pinError = ref<string | null>(null);

  /** True once the pin has moved. */
  async function pin(version: string): Promise<boolean> {
    if (pinning.value) return false;
    pinning.value = version;
    pinError.value = null;
    try {
      const { pinned, lineId } = await $fetch<{ pinned: string; lineId: string }>(
        `/api/recipes/${version}/pin`,
        { method: "PUT", retry: 0 },
      );
      // One pin per line: every version of it already read says so now.
      if (request.data.value) {
        const current = request.data.value.history;
        request.data.value = {
          history: {
            ...current,
            versions: current.versions.map((entry) => ({ ...entry, pinned: entry.id === pinned })),
          },
        };
      }
      cache.value = Object.fromEntries(
        Object.entries(cache.value).map(([key, recipe]): [string, SavedRecipe] => [
          key,
          recipe.lineId === lineId ? { ...recipe, pinned: key === pinned } : recipe,
        ]),
      );
      // The collection's entry for this line is a different version now.
      await refreshNuxtData("recipes");
      notify("Pinned. Your collection shows this version now");
      return true;
    } catch (error) {
      pinError.value = pinMessage(error);
      // Gone from under us: what is left of the line is worth reading again.
      if ((error as Failure).statusCode === 404) void request.refresh();
      return false;
    } finally {
      pinning.value = null;
    }
  }

  return {
    history,
    tree,
    pinnedId,
    status: request.status,
    error: request.error,
    refresh: request.refresh,
    pinning,
    pinError,
    pin,
  };
}
