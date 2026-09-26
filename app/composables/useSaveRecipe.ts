import type { ExtractedRecipe, SavedRecipe } from "#shared/types/recipe";

// Adding an extracted recipe to the collection: one POST, which writes a row
// every time it is sent. Like useExtraction, it answers in words a person can
// act on rather than passing the server's own messages through.

export type SaveFailure = {
  action: "signIn" | "retry" | "none";
  message: string;
};

function failureFor(status: number | undefined): SaveFailure {
  switch (status) {
    case undefined:
      return {
        action: "retry",
        message:
          "We couldn’t reach Recipeat. Check your connection and try again.",
      };
    case 401:
      return {
        action: "signIn",
        message:
          "You’ve been signed out. Sign in again to add it; this recipe will still be here.",
      };
    // The deployment has no database configured. Nothing the user can fix.
    case 503:
      return {
        action: "none",
        message:
          "Saving isn’t available right now. Your recipe can’t be added to a collection on this server.",
      };
    // 400, 413 and 422 cannot happen for an unedited extraction, so reaching
    // one is a bug, and so is anything else.
    default:
      return {
        action: "none",
        message: "Something went wrong while saving this recipe.",
      };
  }
}

// Signing in leaves the page, and an extraction is not something to lose to
// a redirect: it cost a model run, and the input may be gone. It waits here
// until the user is back.
const STASH_KEY = "recipeat-unsaved-recipe";

export function stashRecipe(recipe: ExtractedRecipe) {
  try {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(recipe));
  } catch {}
}

export function unstashRecipe(): ExtractedRecipe | null {
  try {
    const value = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    return value ? (JSON.parse(value) as ExtractedRecipe) : null;
  } catch {
    return null;
  }
}

export function useSaveRecipe() {
  const pending = ref(false);
  const failure = ref<SaveFailure | null>(null);

  /**
   * The stored recipe, or null: the save failed (`failure` says why), or one
   * was already under way. Nothing is reshaped on the way out — the server
   * rebuilds ids, parts and links itself.
   */
  async function save(recipe: ExtractedRecipe): Promise<SavedRecipe | null> {
    // Every POST is another row, so a second one is refused, not queued.
    if (pending.value) return null;
    pending.value = true;
    failure.value = null;
    try {
      const { recipe: saved } = await $fetch<{ recipe: SavedRecipe }>(
        "/api/recipes",
        { method: "POST", body: { recipe }, retry: 0 },
      );
      return saved;
    } catch (error) {
      failure.value = failureFor((error as { statusCode?: number }).statusCode);
      return null;
    } finally {
      pending.value = false;
    }
  }

  return { pending, failure, save };
}
