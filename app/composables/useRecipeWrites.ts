import type { RecipeDeletion, SavedRecipe } from "#shared/types/recipe";
import type { RecipeEditor } from "~/composables/useRecipeEditor";

// What a recipe page writes: an edit saved one of three ways (#30), a version
// deleted (#50) — this one, or another in its line from its history (#31). Each answers in words a person can act on, and none
// says it happened until the server has said so.

export type SaveAction = "progression" | "variant" | "overwrite";

const ROUTE: Record<SaveAction, (id: string) => [method: "PUT" | "POST", url: string]> = {
  overwrite: (id) => ["PUT", `/api/recipes/${id}`],
  progression: (id) => ["POST", `/api/recipes/${id}/progressions`],
  variant: (id) => ["POST", `/api/recipes/${id}/variants`],
};

type Failure = { statusCode?: number; data?: { message?: string } };

function saveMessage(error: unknown): string {
  const { statusCode, data } = error as Failure;
  switch (statusCode) {
    case undefined:
      return "We couldn’t reach Recipeat. Check your connection and try again.";
    case 401:
      return "You’ve been signed out. Sign in again in another tab, then save; your changes stay here until you leave this page.";
    case 404:
      return "This recipe isn’t in your collection any more, so there is nothing to save from.";
    // Two versions made in one line at the same moment; one got there first.
    case 409:
      return "This recipe changed while it was being saved. Nothing was written; try again.";
    case 503:
      return "Saving isn’t available on this server.";
    // The content itself was refused. The editor stops most of this before
    // it is sent; the server's own words say what is left.
    case 400:
    case 413:
    case 422:
      return data?.message ?? "Recipeat couldn’t save this recipe as it is.";
    default:
      return "Something went wrong while saving. Your changes are still here.";
  }
}

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
 * `id` is the version on the page. `show` puts a recipe on the page: the one
 * an overwrite returned, in place; `open` goes to another one — a new version,
 * a new recipe, or what is left of the line after a delete. `pruned` hears
 * about a deletion that left this version standing, so the history it was
 * made from can be read again.
 */
export function useRecipeWrites(
  id: string,
  editor: RecipeEditor,
  show: (recipe: SavedRecipe) => void,
  open: (path: string) => Promise<unknown>,
  pruned: () => unknown = () => {},
) {
  const list = useRecipeListCache();
  const cache = useRecipeCache();
  const { notify } = useToast();

  // The listing shows the pinned version of each line, newest line first. A
  // new version moves a line's pin and a delete can too, so the listing is
  // read again rather than guessed at.
  const relist = () => refreshNuxtData("recipes");

  // ── Saving ───────────────────────────────────────────────────────────────

  const saving = ref<SaveAction | null>(null);
  const saveError = ref<string | null>(null);
  watch(editor.edited, (value) => {
    if (!value) saveError.value = null;
  });

  /** True once the edit is written. */
  async function save(action: SaveAction): Promise<boolean> {
    const body = editor.body.value;
    if (!body || saving.value) return false;
    saving.value = action;
    saveError.value = null;
    try {
      const [method, url] = ROUTE[action](id);
      const { recipe: stored } = await $fetch<{ recipe: SavedRecipe }>(url, {
        method,
        body: { recipe: body },
        retry: 0,
      });
      cache.value = { ...cache.value, [stored.id]: stored };
      if (action === "overwrite") {
        // Rendered from what came back, re-linked amounts and all, and the
        // edit starts over from it.
        show(stored);
        list.update(stored);
        notify("Saved");
      } else {
        // The version on the page is untouched; what was written is a new
        // row, and that is where the reader goes.
        editor.reset();
        if (action === "variant") list.add(stored);
        else void relist();
        notify(action === "variant" ? "Saved as a separate recipe" : "Saved as a new version");
        await open(`/recipes/${stored.id}`);
      }
      return true;
    } catch (error) {
      saveError.value = saveMessage(error);
      return false;
    } finally {
      saving.value = null;
    }
  }

  // ── Deleting ─────────────────────────────────────────────────────────────

  // Asked about: which version, and how many would go with it, read before
  // anything goes.
  const deleting = ref<{ id: string; count: number } | null>(null);
  const deletePending = ref(false);
  const deleteError = ref<string | null>(null);

  // Gone already, or never theirs: either way it is not there any more, which
  // is what was asked for.
  // Only a deletion that took the version on the page leaves it; one made
  // from its history further down the line stays where it is.
  async function gone(ids: string[], pinned: string | null) {
    deleting.value = null;
    cache.value = Object.fromEntries(Object.entries(cache.value).filter(([key]) => !ids.includes(key)));
    for (const removed of ids) clearNuxtData(`recipe:${removed}`);
    if (!ids.includes(id)) {
      await Promise.all([relist(), pruned()]);
      return;
    }
    editor.reset();
    await relist();
    await open(pinned ? `/recipes/${pinned}` : "/recipes");
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
      deleting.value = { id: target, count: deletion.count };
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
    saving,
    saveError,
    save,
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
