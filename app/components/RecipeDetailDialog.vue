<script setup lang="ts">
import type { ExtractedRecipe } from "#shared/types/recipe";
import type { ShelfRecipe } from "~/data/recipes";
const props = defineProps<{
  recipe: ExtractedRecipe | ShelfRecipe | null;
  saved: boolean;
}>();
const emit = defineEmits<{ close: []; save: [recipe: ShelfRecipe] }>();
// Only a recipe on the shelf has an id to save it by. A fresh extraction gets
// its own way into the collection in #41.
const shelved = computed(() =>
  props.recipe && "id" in props.recipe ? props.recipe : null,
);
const eyebrow = computed(() =>
  props.recipe
    ? [
        SOURCE_LABEL[props.recipe.source.type],
        formatMinutes(props.recipe.totalTime),
      ]
        .filter(Boolean)
        .join(" · ")
        .toUpperCase()
    : "",
);
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
      <img
        v-if="recipe.image"
        class="detail-image"
        :src="recipe.image"
        :alt="recipeTitle(recipe)"
      />
      <div class="detail-content">
        <div class="eyebrow">{{ eyebrow }}</div>
        <h2 id="recipe-title">{{ recipeTitle(recipe) }}</h2>
        <button
          v-if="shelved"
          class="button small"
          @click="emit('save', shelved)"
        >
          <AppIcon :name="saved ? 'check' : 'bookmark'" :size="17" />{{
            saved ? "Saved to your collection" : "Save to my collection"
          }}
        </button>
        <template v-if="recipe.ingredients.length">
          <h3>
            Ingredients
            <small v-if="recipe.portions">Serves {{ recipe.portions }}</small>
          </h3>
          <ul>
            <li v-for="ingredient in recipe.ingredients" :key="ingredient.id">
              {{ ingredient.originalText }}
            </li>
          </ul>
        </template>
        <template v-if="recipe.steps.length">
          <h3>Let’s make it</h3>
          <ol>
            <li v-for="step in recipe.steps" :key="step.id">
              {{ step.originalText }}
            </li>
          </ol>
        </template>
      </div>
    </template>
  </BaseDialog>
</template>
