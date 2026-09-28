<script setup lang="ts">
import type { ExtractedRecipe } from "#shared/types/recipe";
import type { RecipeBody } from "#shared/utils/recipeDraft";

const { recipe: selected, importing, openRecipe, openImport } = useDialogs();
const { message: toast, notify } = useToast();
const list = useRecipeListCache();
const adding = useSaveRecipe();
const { login } = useOidcAuth();
const picker = useCollectionPicker();
// Which dialog is open, not which recipe: a fresh import turning into its
// stored row is the same dialog, and focus stays where the user left it.
useDialogFocus(
  computed(() =>
    importing.value ? "import" : selected.value ? "recipe" : picker.target.value ? "picker" : null,
  ),
);
// A failure belongs to the recipe it happened to.
watch(selected, () => (adding.failure.value = null));

onMounted(() => {
  // The collection used to be a list of sample ids kept in this browser. It is
  // on the server now, and the old key is only something to clear away.
  try {
    localStorage.removeItem("recipeat-saved");
  } catch {}
  // A fresh import that was waiting out a sign-in comes back as it was, still
  // unsaved: adding it is the user's call, not something to redo behind them.
  const recipe = unstashRecipe();
  if (recipe) openRecipe(recipe);
});

async function addToCollection(recipe: ExtractedRecipe, body: RecipeBody) {
  const stored = await adding.save(body);
  if (!stored) return;
  // The dialog may have been closed, or moved on, while the POST was out;
  // the row is written either way, so the user hears about it either way.
  if (selected.value === recipe) selected.value = stored;
  list.add(stored);
  notify("A little deliciousness, added to your collection");
}

function signInToAdd(recipe: ExtractedRecipe) {
  stashRecipe(recipe);
  login("zitadel");
}
</script>

<template>
  <div>
    <SiteHeader @import="openImport" />
    <main>
      <NuxtPage />
    </main>
    <SiteFooter />
    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">
        <AppIcon name="check" :size="18" />{{ toast }}
      </div>
    </Transition>
    <RecipeImportDialog
      :open="importing"
      @close="importing = false"
      @extracted="openRecipe"
      @resume="openImport"
    />
    <RecipeDetailDialog
      :recipe="selected"
      :adding="adding.pending.value"
      :add-failure="adding.failure.value"
      @close="selected = null"
      @add="addToCollection"
      @sign-in="signInToAdd"
    />
    <CollectionPicker />
  </div>
</template>
