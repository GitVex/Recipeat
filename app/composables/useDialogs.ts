import type { ExtractedRecipe, SavedRecipe } from "#shared/types/recipe";
import type { ShelfRecipe } from "~/data/recipes";

// The two dialogs live in app.vue, above every page, so that importing works
// from anywhere and a recipe being added survives a navigation. Pages open them
// through here rather than by emitting up a tree they are not in.
export type OpenRecipe = ExtractedRecipe | ShelfRecipe | SavedRecipe;

export function useDialogs() {
  const recipe = useState<OpenRecipe | null>("dialog-recipe", () => null);
  const importing = useState("dialog-import", () => false);
  return {
    recipe,
    importing,
    openRecipe(value: OpenRecipe) {
      importing.value = false;
      recipe.value = value;
    },
    openImport() {
      importing.value = true;
    },
  };
}
