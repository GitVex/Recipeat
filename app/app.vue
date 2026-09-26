<script setup lang="ts">
import type { ExtractedRecipe, SavedRecipe } from "#shared/types/recipe";
import { recipes, type ShelfRecipe } from "~/data/recipes";

type OpenRecipe = ExtractedRecipe | ShelfRecipe | SavedRecipe;

const { saved, toast, save, notify } = useRecipeCollection(recipes);
const adding = useSaveRecipe();
const { login } = useOidcAuth();
const selected = ref<OpenRecipe | null>(null);
const showImport = ref(false);
const collectionOnly = ref(false);
// Which dialog is open, not which recipe: a fresh import turning into its
// stored row is the same dialog, and focus stays where the user left it.
useDialogFocus(
  computed(() =>
    showImport.value ? "import" : selected.value ? "recipe" : null,
  ),
);

function openRecipe(recipe: OpenRecipe) {
  showImport.value = false;
  adding.failure.value = null;
  selected.value = recipe;
}

// A fresh import that was waiting out a sign-in comes back as it was, still
// unsaved: adding it is the user's call, not something to redo behind them.
onMounted(() => {
  const recipe = unstashRecipe();
  if (recipe) openRecipe(recipe);
});

async function addToCollection(recipe: ExtractedRecipe) {
  const stored = await adding.save(recipe);
  if (!stored) return;
  // The dialog may have been closed, or moved on, while the POST was out;
  // the row is written either way, so the user hears about it either way.
  if (selected.value === recipe) selected.value = stored;
  notify("A little deliciousness, added to your collection");
}

function signInToAdd(recipe: ExtractedRecipe) {
  stashRecipe(recipe);
  login("zitadel");
}

function openCollection() {
  collectionOnly.value = true;
  document.getElementById("recipes")?.scrollIntoView({ behavior: "smooth" });
}
</script>

<template>
  <div>
    <SiteHeader
      :saved-count="saved.length"
      @import="showImport = true"
      @collection="openCollection"
      @browse="collectionOnly = false"
    />
    <main>
      <LandingHero
        @import="showImport = true"
        @preview="openRecipe(recipes[0])"
      />
      <LandingSources />
      <LandingHowItWorks />
      <RecipeShelf
        v-model:collection-only="collectionOnly"
        :recipes="recipes"
        :saved="saved"
        @select="openRecipe"
        @save="save"
      />
      <LandingClosing @import="showImport = true" />
    </main>
    <SiteFooter />
    <div v-if="toast" class="toast" role="status">
      <AppIcon name="check" :size="18" />{{ toast }}
    </div>
    <RecipeImportDialog
      :open="showImport"
      @close="showImport = false"
      @extracted="openRecipe"
      @resume="showImport = true"
    />
    <RecipeDetailDialog
      :recipe="selected"
      :saved="!!selected && 'id' in selected && saved.includes(selected.id)"
      :adding="adding.pending.value"
      :add-failure="adding.failure.value"
      @close="selected = null"
      @save="save"
      @add="addToCollection"
      @sign-in="signInToAdd"
    />
  </div>
</template>
