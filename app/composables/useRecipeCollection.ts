import type { Recipe } from "~/types/recipe";

export function useRecipeCollection(recipes: Recipe[]) {
  const saved = ref<number[]>([]);
  const toast = ref("");
  let toastTimer: ReturnType<typeof setTimeout>;
  onMounted(() => {
    try {
      const value = JSON.parse(localStorage.getItem("recipeat-saved") || "[]");
      if (Array.isArray(value))
        saved.value = value.filter((id) => recipes.some((r) => r.id === id));
    } catch {}
  });
  onBeforeUnmount(() => clearTimeout(toastTimer));
  function save(recipe: Recipe) {
    const exists = saved.value.includes(recipe.id);
    saved.value = exists
      ? saved.value.filter((id) => id !== recipe.id)
      : [...saved.value, recipe.id];
    try {
      localStorage.setItem("recipeat-saved", JSON.stringify(saved.value));
    } catch {}
    toast.value = exists
      ? "Recipe removed from your collection"
      : "A little deliciousness, saved to your collection";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 3500);
  }
  return { saved, toast, save };
}
