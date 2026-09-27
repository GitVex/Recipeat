<script setup lang="ts">
import type { ShelfRecipe } from "~/data/recipes";
// The landing page's samples: there to show what a recipe looks like here,
// not to be kept. A person's own recipes are on /recipes.
defineProps<{ recipes: ShelfRecipe[] }>();
const emit = defineEmits<{ select: [recipe: ShelfRecipe] }>();
</script>

<template>
  <section id="recipes" class="recipes-section page-width">
    <div class="section-heading">
      <div>
        <div class="eyebrow">THE INSPIRATION SHELF</div>
        <h2>Meet your next <em>“make again.”</em></h2>
      </div>
      <NuxtLink class="text-button" to="/recipes">
        View your collection <AppIcon name="arrow" :size="18" />
      </NuxtLink>
    </div>
    <div class="recipe-grid">
      <RecipeCard
        v-for="recipe in recipes"
        :key="recipe.id"
        :recipe="recipe"
        @select="emit('select', $event)"
      />
    </div>
  </section>
</template>
