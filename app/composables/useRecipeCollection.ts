import type { ShelfRecipe } from "~/data/recipes";

export function useRecipeCollection(recipes: ShelfRecipe[]) {
  const saved = ref<string[]>([]);
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
  function save(recipe: ShelfRecipe) {
    const exists = saved.value.includes(recipe.id);
    saved.value = exists
      ? saved.value.filter((id) => id !== recipe.id)
      : [...saved.value, recipe.id];
    try {
      localStorage.setItem("recipeat-saved", JSON.stringify(saved.value));
    } catch {}
    notify(
      exists
        ? "Recipe removed from your collection"
        : "A little deliciousness, saved to your collection",
    );
  }
  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 3500);
  }
  return { saved, toast, save, notify };
}
