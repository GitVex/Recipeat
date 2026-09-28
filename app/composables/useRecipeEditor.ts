import type { ExtractedRecipe } from "#shared/types/recipe";
import {
  blankIngredient,
  blankStep,
  bodyOf,
  editOf,
  isEdited,
  stepsInOrder,
  type RecipeEdit,
} from "#shared/utils/recipeDraft";
import { LIMITS } from "#shared/utils/recipeLimits";

// The edit a recipe page holds: text in every field, and what it would send.
// A new recipe arriving — the one a save returned, or another opened in its
// place — has an edit of its own, starting from it.
export function useRecipeEditor(recipe: Ref<ExtractedRecipe | null>) {
  const start = (value: ExtractedRecipe | null): RecipeEdit | null => {
    if (!value) return null;
    // From the plain objects: a reactive recipe would hand out proxies here,
    // and the same step read later through it, once marked raw, would not be
    // the same object.
    const edit = editOf(toRaw(value));
    // Kept as the objects they are, not reactive copies: an untouched row is
    // recognised by being the very ingredient or step it started as.
    for (const row of [...edit.ingredients, ...edit.steps]) if (row.from) markRaw(row.from);
    return edit;
  };

  // One edit per recipe, made the first time that recipe is asked for rather
  // than when it arrives: on the server the recipe comes after setup, and a
  // watcher would never see it, leaving the server's page read-only and the
  // browser's editable. `generation` starts an edit over on reset.
  const edits = new WeakMap<ExtractedRecipe, RecipeEdit>();
  const generation = ref(0);
  const edit = computed<RecipeEdit | null>(() => {
    void generation.value;
    const value = recipe.value;
    if (!value) return null;
    const key = toRaw(value);
    if (!edits.has(key)) edits.set(key, reactive(start(value)!) as RecipeEdit);
    return edits.get(key)!;
  });

  const edited = computed(
    () => !!recipe.value && !!edit.value && isEdited(recipe.value, edit.value),
  );
  const result = computed(() =>
    recipe.value && edit.value
      ? bodyOf(recipe.value, edit.value)
      : { body: null, problems: [] },
  );
  const inOrder = computed(
    () => !!recipe.value && !!edit.value && stepsInOrder(recipe.value, edit.value),
  );

  function move<T>(list: T[], index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    const [row] = list.splice(index, 1);
    list.splice(target, 0, row!);
  }

  return {
    edit,
    edited,
    body: computed(() => result.value.body),
    problems: computed(() => result.value.problems),
    // Whether the steps still read in the source's order, and so by its numbers.
    inOrder,
    reset() {
      if (recipe.value) edits.delete(toRaw(recipe.value));
      generation.value++;
    },
    canAddIngredient: computed(() => (edit.value?.ingredients.length ?? 0) < LIMITS.ingredients),
    canAddStep: computed(() => (edit.value?.steps.length ?? 0) < LIMITS.steps),
    addIngredient() {
      if (edit.value && edit.value.ingredients.length < LIMITS.ingredients)
        edit.value.ingredients.push(blankIngredient());
    },
    addStep() {
      if (edit.value && edit.value.steps.length < LIMITS.steps) edit.value.steps.push(blankStep());
    },
    removeIngredient: (index: number) => edit.value?.ingredients.splice(index, 1),
    removeStep: (index: number) => edit.value?.steps.splice(index, 1),
    moveIngredient: (index: number, by: -1 | 1) => edit.value && move(edit.value.ingredients, index, by),
    moveStep: (index: number, by: -1 | 1) => edit.value && move(edit.value.steps, index, by),
  };
}

export type RecipeEditor = ReturnType<typeof useRecipeEditor>;
