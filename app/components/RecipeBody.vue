<script setup lang="ts">
import type { ExtractedRecipe } from "#shared/types/recipe";
import {
  hasConvertible,
  ingredientText,
  partText,
  stepTexts,
} from "#shared/utils/recipeText";

// A recipe as it reads, wherever it is open: the dialog, the collection's
// preview, and its own page. What can be done with it goes in the slot, between
// the title and the ingredients.
const props = withDefaults(
  defineProps<{ recipe: ExtractedRecipe; titleId: string; titleTag?: "h1" | "h2" }>(),
  { titleTag: "h2" },
);

const eyebrow = computed(() =>
  [SOURCE_LABEL[props.recipe.source.type], formatMinutes(props.recipe.totalTime)]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase(),
);

// Amounts print from the parsed quantities and steps from their parts, so an
// amount a step restates is the ingredient's, not a copy of it.
const recipe = toRef(props, "recipe");
const { system, toggle } = useUnitSystem(recipe);
const convertible = computed(() => hasConvertible(props.recipe));
const lang = computed(() => props.recipe.source_lang);
const ingredients = computed(() =>
  props.recipe.ingredients.map((ingredient) => ({
    id: ingredient.id,
    ...ingredientText(ingredient, lang.value, system.value),
  })),
);
const byId = computed(
  () => new Map(props.recipe.ingredients.map((ingredient) => [ingredient.id, ingredient])),
);
const steps = computed(() =>
  stepTexts(props.recipe.steps).map(({ number, parts }, index) => {
    const step = props.recipe.steps[index]!;
    return {
      id: step.id,
      number,
      parts: parts.map((part) => partText(part, step, byId.value, lang.value, system.value)),
    };
  }),
);
</script>

<template>
  <img
    v-if="recipe.image"
    class="detail-image"
    :src="recipe.image"
    :alt="recipeTitle(recipe)"
  />
  <div class="detail-content">
    <div class="eyebrow">{{ eyebrow }}</div>
    <div class="title-row">
      <component
        :is="titleTag"
        :id="titleId"
        class="detail-title"
        :class="{ untitled: !recipe.title }"
      >
        {{ recipeTitle(recipe) }}
      </component>
      <!-- Only where switching would change something on the page. -->
      <UnitToggle v-if="convertible" :system="system" @toggle="toggle" />
    </div>
    <slot />
    <template v-if="ingredients.length">
      <h3>
        Ingredients
        <small v-if="recipe.portions">Serves {{ recipe.portions }}</small>
      </h3>
      <ul>
        <li v-for="ingredient in ingredients" :key="ingredient.id">
          <span v-if="ingredient.amount" class="amount">{{ ingredient.amount }}</span>
          {{ ingredient.name }}
          <span v-if="ingredient.extra" class="ingredient-extra">{{
            ingredient.extra
          }}</span>
        </li>
      </ul>
    </template>
    <template v-if="steps.length">
      <h3>Let’s make it</h3>
      <ol class="step-list">
        <li v-for="step in steps" :key="step.id" :class="{ unnumbered: step.number === null }">
          <span v-if="step.number !== null" class="step-mark">{{ step.number }}.</span>
          <span
            ><template v-for="(part, index) in step.parts" :key="index"
              ><span v-if="part.amount" class="amount">{{ part.text }}</span
              ><template v-else>{{ part.text }}</template></template
            ></span
          >
        </li>
      </ol>
    </template>
  </div>
</template>
