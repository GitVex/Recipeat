import type { ExtractedRecipe, RecipeSource } from "#shared/types/recipe";

// How a recipe reads on the page, in one place, so a card and the open recipe
// say the same thing about it.

// Extraction may find ingredients and steps and no name for them.
export const recipeTitle = (recipe: Pick<ExtractedRecipe, "title">) =>
  recipe.title ?? "Untitled recipe";

export const SOURCE_LABEL: Record<RecipeSource["type"], string> = {
  website: "From a website",
  photo: "From a photo",
  text: "From your notes",
};

export const SOURCE_ICON: Record<RecipeSource["type"], string> = {
  website: "link",
  photo: "camera",
  text: "text",
};

// Minutes as a person would say them: "25 min", "1 h 30 min", "2 h".
export function formatMinutes(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
