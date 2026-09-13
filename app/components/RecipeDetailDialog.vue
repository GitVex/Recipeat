<script setup lang="ts">
import type { Recipe } from "~/types/recipe";
defineProps<{ recipe: Recipe | null; saved: boolean }>();
const emit = defineEmits<{ close: []; save: [recipe: Recipe] }>();
</script>

<template>
  <BaseDialog
    :open="!!recipe"
    title-id="recipe-title"
    close-label="Close recipe"
    modal-class="detail-modal"
    @close="emit('close')"
  >
    <template v-if="recipe">
      <img class="detail-image" :src="recipe.image" :alt="recipe.title" />
      <div class="detail-content">
        <div class="eyebrow">SAMPLE RECIPE · {{ recipe.time }}</div>
        <h2 id="recipe-title">{{ recipe.title }}</h2>
        <button class="button small" @click="emit('save', recipe)">
          <AppIcon :name="saved ? 'check' : 'bookmark'" :size="17" />{{
            saved ? "Saved to your collection" : "Save to my collection"
          }}
        </button>
        <h3>Ingredients <small>Serves 2</small></h3>
        <ul>
          <li v-for="ingredient in recipe.ingredients" :key="ingredient">
            {{ ingredient }}
          </li>
        </ul>
        <h3>Let’s make it</h3>
        <ol>
          <li v-for="step in recipe.steps" :key="step">{{ step }}</li>
        </ol>
      </div>
    </template>
  </BaseDialog>
</template>
