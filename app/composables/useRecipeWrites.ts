import type { SavedRecipe } from "#shared/types/recipe";
import type { RecipeEditor } from "~/composables/useRecipeEditor";

// What a recipe page writes: an edit saved one of three ways (#30), and a
// version deleted (#50) — this one, or another on the path to it (#31). Each answers in words a person can act on, and none
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
      return "This recipe isn’t in your recipes any more, so there is nothing to save from.";
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

  // Deleting is the same from a recipe page as from its lineage; what differs
  // is where a reader goes once the version on the page is gone.
  const deletion = useRecipeDelete(id, {
    async left(pinned) {
      editor.reset();
      await open(pinned ? `/recipes/${pinned}` : "/recipes");
    },
    pruned,
  });

  return { saving, saveError, save, ...deletion };
}
