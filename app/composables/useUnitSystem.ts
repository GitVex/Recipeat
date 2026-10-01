import type { ExtractedRecipe } from "#shared/types/recipe";
import { recipeSystem, type UnitSystem } from "#shared/utils/recipeText";

// Which system amounts are shown in. Until the reader picks one, each recipe
// shows the system it was written in; once they do, every recipe follows it.
// A cookie rather than localStorage, so the server renders the same amounts
// the browser will.
//
// Signed in, the account's choice (#62) is that default instead, and is only
// changed on the profile: the toggle here changes this view of this recipe.
export function useUnitSystem(recipe: Ref<ExtractedRecipe>) {
  const { preferences: account } = usePreferences();
  const chosen = useCookie<UnitSystem | null>("recipeat-units", {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const viewed = ref<UnitSystem | null>(null);
  const system = computed<UnitSystem>(() => {
    const preferred = viewed.value ?? (account.value ? account.value.unitSystem : chosen.value);
    return preferred === "imperial" || preferred === "metric" ? preferred : recipeSystem(recipe.value);
  });
  function toggle() {
    const next = system.value === "metric" ? "imperial" : "metric";
    if (account.value) viewed.value = next;
    else chosen.value = next;
  }
  return { system, toggle };
}
