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
