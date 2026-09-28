<script setup lang="ts">
import type { ShelfRecipe } from "~/data/recipes";
defineProps<{ recipe: ShelfRecipe }>();
const emit = defineEmits<{ select: [recipe: ShelfRecipe] }>();
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
      >
    </div>
    <div class="recipe-info">
      <button class="recipe-title" @click="emit('select', recipe)">
        {{ recipeTitle(recipe) }}
      </button>
      <div v-if="recipe.totalTime" class="recipe-meta">
        <span
          ><AppIcon name="clock" :size="14" />{{
            formatMinutes(recipe.totalTime)
          }}</span
        >
      </div>
      <TagList :tags="recipe.tags" />
    </div>
  </article>
</template>
