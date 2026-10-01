import type { SavedRecipe } from "#shared/types/recipe";
import { scaledPortions, UNSCALED, type Scale } from "#shared/utils/recipeScale";
import type { UnitSystem } from "#shared/utils/recipeText";

type Stored = Scale & { id: string; system: UnitSystem };

// How the open recipe is scaled. A scale is a way of reading the recipe, not
// a change to it: it survives a reload of the same recipe and is dropped on
// opening another. A session cookie rather than sessionStorage, so the server
// renders the same amounts the browser will.
//
// Signed in with default servings (#62), a recipe that says how many it
// serves opens scaled to them; scaling it by hand still wins, for this recipe.
export function useRecipeScale(recipe: Ref<SavedRecipe>, system: Ref<UnitSystem>) {
  const { preferences: account } = usePreferences();
  const preferred = computed<Scale>(() => {
    const portions = account.value?.portions;
    return portions && recipe.value.portions
      ? { factor: portions / recipe.value.portions, anchor: "portions", value: null }
      : UNSCALED;
  });

  const stored = useCookie<Stored | null>("recipeat-scale", {
    default: () => null,
    sameSite: "lax",
  });

  const scale = computed<Scale>(() => {
    const value = stored.value;
    if (!value || value.id !== recipe.value.id) return preferred.value;
    if (typeof value.factor !== "number" || !(value.factor > 0) || !Number.isFinite(value.factor))
      return UNSCALED;
    // An amount typed in one system is not that number in the other; the
    // factor still holds, and the anchoring line is shown rounded like the rest.
    return { ...value, value: value.system === system.value ? value.value : null };
  });

  // Another recipe opened: the last one's scale is not this one's.
  onMounted(() => {
    if (stored.value && stored.value.id !== recipe.value.id) stored.value = null;
  });

  // Back where it opens is nothing to keep. Anywhere else is kept, as written
  // included when that is not where it opens.
  function set(next: Scale) {
    stored.value =
      Math.abs(next.factor - preferred.value.factor) < 1e-9
        ? null
        : { ...next, id: recipe.value.id, system: system.value };
  }

  return {
    scale,
    portions: computed(() =>
      recipe.value.portions === null ? null : scaledPortions(recipe.value.portions, scale.value.factor),
    ),
    setPortions(portions: number) {
      if (recipe.value.portions && portions > 0)
        set({ factor: portions / recipe.value.portions, anchor: "portions", value: null });
    },
    /** One ingredient set to `value` of what it is shown in, from `base` of it. */
    setAnchor(ingredientId: string, value: number, base: number) {
      if (value > 0 && base > 0) set({ factor: value / base, anchor: ingredientId, value });
    },
    /** As written, whatever it opened at. */
    reset: () => set(UNSCALED),
  };
}
