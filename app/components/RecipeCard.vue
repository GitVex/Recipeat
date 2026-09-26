<script setup lang="ts">
import type { ShelfRecipe } from "~/data/recipes";
defineProps<{ recipe: ShelfRecipe; saved: boolean }>();
const emit = defineEmits<{
  select: [recipe: ShelfRecipe];
  save: [recipe: ShelfRecipe];
}>();
</script>

<template>
  <article class="recipe-card">
    <div class="recipe-image-wrap">
      <button
        class="image-open"
        :aria-label="`View ${recipeTitle(recipe)}`"
        @click="emit('select', recipe)"
      >
        <img
          v-if="recipe.image"
          :src="recipe.image"
          :alt="recipeTitle(recipe)"
          loading="lazy"
        /></button
      ><span class="source-chip"
        ><AppIcon :name="SOURCE_ICON[recipe.source.type]" :size="13" />{{
          SOURCE_LABEL[recipe.source.type]
        }}</span
      ><button
        class="save-button"
        :class="{ saved: saved }"
        :aria-label="`${saved ? 'Unsave' : 'Save'} ${recipeTitle(recipe)}`"
        :aria-pressed="saved"
        @click="emit('save', recipe)"
      >
        <AppIcon :name="saved ? 'check' : 'bookmark'" :size="18" />
      </button>
    </div>
    <div class="recipe-info">
      <button class="recipe-title" @click="emit('select', recipe)">
        {{ recipeTitle(recipe) }}
      </button>
      <div class="recipe-meta">
        <template v-if="recipe.totalTime"
          ><span
            ><AppIcon name="clock" :size="14" />{{
              formatMinutes(recipe.totalTime)
            }}</span
          ><span class="meta-dot">·</span></template
        ><span>Simple ingredients, big smiles</span>
      </div>
    </div>
  </article>
</template>
