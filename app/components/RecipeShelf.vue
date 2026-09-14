<script setup lang="ts">
import type { Recipe } from "~/types/recipe";
const props = defineProps<{ recipes: Recipe[]; saved: number[] }>();
const collectionOnly = defineModel<boolean>("collectionOnly", {
  required: true,
});
const emit = defineEmits<{
  select: [recipe: Recipe];
  save: [recipe: Recipe];
}>();
const visibleRecipes = computed(() =>
  collectionOnly.value
    ? props.recipes.filter((recipe) => props.saved.includes(recipe.id))
    : props.recipes,
);
</script>

<template>
  <section id="recipes" class="recipes-section page-width">
    <div class="section-heading">
      <div>
        <div class="eyebrow">
          {{
            collectionOnly
              ? "SAVED FOR SOMETHING GOOD"
              : "THE INSPIRATION SHELF"
          }}
        </div>
        <h2>
          {{ collectionOnly ? "Your little" : "Meet your next" }}
          <em>{{ collectionOnly ? "collection." : "“make again.”" }}</em>
        </h2>
      </div>
      <button class="text-button" @click="collectionOnly = !collectionOnly">
        {{ collectionOnly ? "Explore recipes" : "View your collection" }}
        <AppIcon name="arrow" :size="18" />
      </button>
    </div>
    <div v-if="visibleRecipes.length" class="recipe-grid">
      <RecipeCard
        v-for="recipe in visibleRecipes"
        :key="recipe.id"
        :recipe="recipe"
        :saved="saved.includes(recipe.id)"
        @select="emit('select', $event)"
        @save="emit('save', $event)"
      />
    </div>
    <div v-else class="empty-collection">
      <AppIcon name="book" :size="35" />
      <h3>Your next favorite belongs here.</h3>
      <p>Tap the bookmark on a recipe to save it to your collection.</p>
      <button class="button" @click="collectionOnly = false">
        Find some inspiration <AppIcon name="arrow" />
      </button>
    </div>
  </section>
</template>
