<script setup lang="ts">
import type { Recipe } from "~/types/recipe";
defineProps<{ recipe: Recipe; saved: boolean }>();
const emit = defineEmits<{
  select: [recipe: Recipe];
  save: [recipe: Recipe];
}>();
</script>

<template>
  <article class="recipe-card">
    <div class="recipe-image-wrap">
      <button
        class="image-open"
        :aria-label="`View ${recipe.title}`"
        @click="emit('select', recipe)"
      >
        <img :src="recipe.image" :alt="recipe.title" loading="lazy" /></button
      ><span class="source-chip"
        ><AppIcon
          :name="recipe.id === 1 ? 'link' : recipe.id === 2 ? 'camera' : 'book'"
          :size="13"
        />{{ recipe.source }}</span
      ><button
        class="save-button"
        :class="{ saved: saved }"
        :aria-label="`${saved ? 'Unsave' : 'Save'} ${recipe.title}`"
        :aria-pressed="saved"
        @click="emit('save', recipe)"
      >
        <AppIcon :name="saved ? 'check' : 'bookmark'" :size="18" />
      </button>
    </div>
    <div class="recipe-info">
      <span class="recipe-category">{{ recipe.category }}</span
      ><button class="recipe-title" @click="emit('select', recipe)">
        {{ recipe.title }}
      </button>
      <div class="recipe-meta">
        <span><AppIcon name="clock" :size="14" />{{ recipe.time }}</span
        ><span class="meta-dot">·</span
        ><span>Simple ingredients, big smiles</span>
      </div>
    </div>
  </article>
</template>
