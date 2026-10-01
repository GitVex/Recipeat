import type { RecipeDeletion } from "#shared/types/recipe";

// Deleting a version (#50), from wherever one is reachable: its own page, the
// path to it, or the whole lineage (#31). The dry run is read first, so the
// question names what goes, and nothing says it happened until the server
// has said so.

type Failure = { statusCode?: number };

function deleteMessage(error: unknown): string {
  switch ((error as Failure).statusCode) {
    case undefined:
      return "We couldn’t reach Recipeat. Check your connection and try again.";
    case 401:
      return "You’ve been signed out. Sign in again to delete it.";
    case 409:
      return "This recipe changed while it was being deleted. Nothing was deleted; try again.";
    case 503:
      return "Deleting isn’t available on this server.";
    default:
      return "Something went wrong, and nothing was deleted.";
  }
}

const isGone = (error: unknown) => (error as Failure).statusCode === 404;

/**
 * `id` is the version the page is about. A deletion that took it calls
 * `left` with the version its line is entered by now — null when the line
 * ended — and the page goes wherever that means for it. One that left it
 * standing calls `pruned`, so what the page drew from the line is read again.
 *
 * Call it in setup: it needs the Nuxt app, which an awaited handler no longer
 * has.
 */
export function useRecipeDelete(
  id: string,
  { left, pruned = () => {} }: { left: (pinned: string | null) => Promise<unknown>; pruned?: () => unknown },
) {
  const cache = useRecipeCache();
  const { relist } = useRecipeListCache();
  const { notify } = useToast();

  // Asked about: which version, and how many would go with it, read before
  // anything goes.
  const deleting = ref<{ id: string; count: number; photos?: number } | null>(null);
  const deletePending = ref(false);
  const deleteError = ref<string | null>(null);

  // Gone already, or never theirs: either way it is not there any more, which
  // is what was asked for. The listing shows each line's pinned version, and a
  // deletion can move a pin, so it is read again rather than guessed at.
  async function gone(ids: string[], pinned: string | null) {
    deleting.value = null;
    cache.value = Object.fromEntries(Object.entries(cache.value).filter(([key]) => !ids.includes(key)));
    for (const removed of ids) clearNuxtData(`recipe:${removed}`);
    if (!ids.includes(id)) {
      await Promise.all([relist(), pruned()]);
      return;
    }
    await relist();
    await left(pinned);
  }

  async function askDelete(target = id) {
    if (deletePending.value) return;
    deletePending.value = true;
    deleteError.value = null;
    try {
      const { deletion } = await $fetch<{ deletion: RecipeDeletion }>(`/api/recipes/${target}`, {
        method: "DELETE",
        query: { dryRun: "true" },
        retry: 0,
      });
      deleting.value = { id: target, count: deletion.count, photos: deletion.photos };
    } catch (error) {
      if (isGone(error)) {
        notify(target === id ? "That recipe was already deleted" : "That version was already deleted");
        await gone([target], null);
      } else {
        // Nothing to confirm yet, so the reason goes where the question would.
        deleting.value = { id: target, count: 0 };
        deleteError.value = deleteMessage(error);
      }
    } finally {
      deletePending.value = false;
    }
  }

  async function confirmDelete() {
    const target = deleting.value?.id;
    if (deletePending.value || !target) return;
    deletePending.value = true;
    deleteError.value = null;
    const deleted = target === id ? "Recipe deleted" : "Version deleted";
    try {
      const { deletion } = await $fetch<{ deletion: RecipeDeletion }>(`/api/recipes/${target}`, {
        method: "DELETE",
        retry: 0,
      });
      notify(deletion.count > 1 ? `Deleted ${deletion.count} versions` : deleted);
      await gone(deletion.ids, deletion.pinned);
    } catch (error) {
      if (isGone(error)) {
        notify(deleted);
        await gone([target], null);
      } else deleteError.value = deleteMessage(error);
    } finally {
      deletePending.value = false;
    }
  }

  return {
    deleting,
    deletePending,
    deleteError,
    askDelete,
    confirmDelete,
    cancelDelete: () => {
      deleting.value = null;
      deleteError.value = null;
    },
  };
}
