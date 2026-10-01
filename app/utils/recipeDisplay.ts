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

// A website source that came through an Instagram post says so, though it
// files under websites (#120).
export const sourceLabel = (source: RecipeSource) =>
  source.type === "website" && source.post ? "From Instagram" : SOURCE_LABEL[source.type];

export const sourceIcon = (source: RecipeSource) =>
  source.type === "website" && source.post ? "post" : SOURCE_ICON[source.type];

// Minutes as a person would say them — shared, because the editor reads them
// back in the same form.
export { formatMinutes } from "#shared/utils/recipeText";
