<script setup lang="ts">
import type { ExtractedRecipe } from "#shared/types/recipe";
import { recipes, type ShelfRecipe } from "~/data/recipes";

const { saved, toast, save } = useRecipeCollection(recipes);
const selected = ref<ExtractedRecipe | ShelfRecipe | null>(null);
const showImport = ref(false);
const collectionOnly = ref(false);
useDialogFocus(computed(() => (showImport.value ? "import" : selected.value)));

function openRecipe(recipe: ExtractedRecipe | ShelfRecipe) {
  showImport.value = false;
  selected.value = recipe;
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
    />
    <RecipeDetailDialog
      :recipe="selected"
      :saved="!!selected && 'id' in selected && saved.includes(selected.id)"
      @close="selected = null"
      @save="save"
    />
  </div>
</template>
