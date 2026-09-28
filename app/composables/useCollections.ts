import type { CollectionSummary } from "#shared/types/collection";

// The owner's collections as GET /api/collections answers them. One key, so
// the picker, the collections page (#71) and the header (#73) read and write
// the same copy.
const KEY = "collections";

type Listing = { collections: CollectionSummary[] };

export function useCollectionList() {
  return useFetch<Listing>("/api/collections", { key: KEY, retry: 0 });
}

/**
 * The cached listing, and a way to read it again after a change. A count and
 * the first four thumbnails both move when a recipe is added or taken out, and
 * the server is the one that knows where, so it is read rather than patched.
 *
 * Call it in setup: it needs the Nuxt app, which an awaited handler no longer
 * has.
 */
export function useCollectionListCache() {
  const { data } = useNuxtData<Listing>(KEY);
  async function reload() {
    data.value = await $fetch<Listing>("/api/collections", { retry: 0 });
    return data.value;
  }
  // A collection opened before this change would show it without its new
  // entry, or with one taken out. Forgotten, it is read again when opened.
  const forget = (collectionId: string) => clearNuxtData(`collection:${collectionId}`);
  return { data, reload, forget };
}

// What the picker is adding: the version on screen, not its line. `pinned`
// is whether it is the line's entry point, so the picker can say when it is
// not.
export type PickerTarget = { id: string; title: string; pinned: boolean };

/**
 * The picker lives in app.vue, above every page, like the other dialogs: the
 * list and the recipe page both open it from here.
 */
export function useCollectionPicker() {
  const target = useState<PickerTarget | null>("collection-picker", () => null);
  return {
    target,
    open(value: PickerTarget) {
      target.value = value;
    },
    close() {
      target.value = null;
    },
  };
}

// What a name the server refused means to a person, wherever it was typed.
export const collectionNameProblem = (status: number | undefined, name: string) =>
  status === 409
    ? `You already have a collection called “${name}”.`
    : status === 413
      ? "That name is too long. Keep it under 80 characters."
      : status === 400
        ? "A collection needs a name, on one line."
        : status === 401
          ? "Your session ended. Sign in again to change your collections."
          : "That didn’t work. Try again.";

/**
 * Renaming and deleting a collection, from its card or from its own page,
 * with the cached listing kept in step. Each throws what `$fetch` threw, so
 * the caller can say what went wrong where it went wrong.
 *
 * Call it in setup.
 */
export function useCollectionWrites() {
  const list = useCollectionListCache();
  async function rename(id: string, name: string) {
    const { collection } = await $fetch<{ collection: { id: string; name: string; updatedAt: string } }>(
      `/api/collections/${id}`,
      { method: "PATCH", body: { name }, retry: 0 },
    );
    if (list.data.value)
      list.data.value = {
        collections: list.data.value.collections.map((c) => (c.id === id ? { ...c, name: collection.name, updatedAt: collection.updatedAt } : c)),
      };
    return collection;
  }
  async function remove(id: string) {
    try {
      await $fetch(`/api/collections/${id}`, { method: "DELETE", retry: 0 });
    } catch (error) {
      // Already gone is what was asked for.
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    }
    if (list.data.value)
      list.data.value = { collections: list.data.value.collections.filter((c) => c.id !== id) };
    list.forget(id);
  }
  return { rename, remove };
}
