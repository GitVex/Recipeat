import type { SavedRecipe } from "#shared/types/recipe";

// "Does this recipe mean bay leaves?" (#173): the lines close to entries in
// the ingredient store, asked of their owner when they contribute to it. Each
// answer goes into the store everyone shares; only a typo changes the recipe,
// which is handed to `onRecipe` with the lines' entries as the answer left
// them. Questions appear as matching finds them, told over Server-Sent Events.
// An "about" question (#181) asks whether a linked line's entry is a liquid,
// for converting its cups to grams; that answer is everyone's.
export type IngredientQuestion =
  | { kind: "match"; lineId: string; name: string; candidates: { ingredientId: string; name: string }[] }
  | { kind: "about"; lineId: string; name: string; ingredientId: string };
export type IngredientAnswer = "alias" | "typo" | "none" | "liquid" | "solid";
type Questions = { lang: string; questions: IngredientQuestion[] };

export function useIngredientQuestions(recipeId: string, onRecipe: (recipe: SavedRecipe) => void) {
  const { preferences } = usePreferences();
  const optedIn = computed(() => preferences.value?.ingredientMatching === "on");

  const { data, refresh } = useFetch<Questions>(`/api/recipes/${recipeId}/ingredients`, {
    key: `ingredient-questions:${recipeId}`,
    retry: 0,
    server: false,
    immediate: false,
  });
  // By line id. Without the opt-in there is nothing to ask, or listen for.
  const questions = computed(
    () => new Map(optedIn.value ? (data.value?.questions ?? []).map((q) => [q.lineId, q]) : []),
  );
  // A recipe of unknown language has none to file a name under (#183).
  const knownLanguage = computed(() => data.value?.lang !== "und");

  let events: EventSource | undefined;
  onMounted(() =>
    watch(
      optedIn,
      (on) => {
        events?.close();
        events = undefined;
        if (!on) return;
        refresh();
        events = new EventSource(`/api/recipes/${recipeId}/ingredients/events`);
        events.addEventListener("matched", () => refresh());
      },
      { immediate: true },
    ),
  );
  onBeforeUnmount(() => events?.close());

  const answering = ref<string | null>(null);
  const failed = ref<string | null>(null);
  async function answer(lineId: string, answer: IngredientAnswer, ingredientId?: string) {
    answering.value = lineId;
    failed.value = null;
    try {
      const { recipe, ...rest } = await $fetch<Questions & { recipe: SavedRecipe }>(
        `/api/recipes/${recipeId}/ingredients`,
        { method: "POST", body: { lineId, answer, ingredientId }, retry: 0 },
      );
      data.value = rest;
      onRecipe(recipe);
    } catch {
      failed.value = lineId;
    } finally {
      answering.value = null;
    }
  }

  return { questions, knownLanguage, answering, failed, answer };
}
