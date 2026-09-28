import type { ExtractedRecipe } from "#shared/types/recipe";
import { recipeSystem, type UnitSystem } from "#shared/utils/recipeText";

// Which system amounts are shown in. Until the reader picks one, each recipe
// shows the system it was written in; once they do, every recipe follows it.
// A cookie rather than localStorage, so the server renders the same amounts
// the browser will.
export function useUnitSystem(recipe: Ref<ExtractedRecipe>) {
  const chosen = useCookie<UnitSystem | null>("recipeat-units", {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const system = computed<UnitSystem>(() =>
    chosen.value === "imperial" || chosen.value === "metric"
      ? chosen.value
      : recipeSystem(recipe.value),
  );
  function toggle() {
    chosen.value = system.value === "metric" ? "imperial" : "metric";
  }
  return { system, toggle };
}
