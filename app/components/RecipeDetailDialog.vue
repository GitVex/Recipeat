<script setup lang="ts">
import type { ExtractedRecipe, SavedRecipe } from "#shared/types/recipe";
import type { ShelfRecipe } from "~/data/recipes";
import type { SaveFailure } from "~/composables/useSaveRecipe";
const props = defineProps<{
  recipe: ExtractedRecipe | ShelfRecipe | SavedRecipe | null;
  // The sample's browser-local flag.
  saved: boolean;
  // Adding a fresh import to the collection.
  adding: boolean;
  addFailure: SaveFailure | null;
}>();
const emit = defineEmits<{
  close: [];
  save: [recipe: ShelfRecipe];
  add: [recipe: ExtractedRecipe];
  signIn: [recipe: ExtractedRecipe];
}>();

// Three kinds of recipe open here. A stored one has a row, and with it a line;
// a sample has an id and no line; a fresh import has neither, and is the only
// one that can still be lost.
const stored = computed(() =>
  props.recipe && "lineId" in props.recipe ? props.recipe : null,
);
const sample = computed(() =>
  props.recipe && "id" in props.recipe && !stored.value
    ? (props.recipe as ShelfRecipe)
    : null,
);
const fresh = computed(() =>
  props.recipe && !("id" in props.recipe) ? props.recipe : null,
);

// Closing a fresh import asks first. Asking again — Escape, the close button,
// the backdrop — puts the question away rather than answering it, so only
// "Close anyway" throws the recipe away.
const confirming = ref(false);
const savedNote = ref<HTMLElement | null>(null);
watch(
  () => props.recipe,
  async (_, previous) => {
    confirming.value = false;
    // The button that was pressed is gone once the row exists, so focus goes
    // to what replaced it rather than falling out of the dialog.
    if (stored.value && previous && !("id" in previous)) {
      await nextTick();
      savedNote.value?.focus();
    }
  },
);
function add() {
  confirming.value = false;
  if (fresh.value) emit("add", fresh.value);
}
function requestClose() {
  if (fresh.value && !props.adding && !confirming.value) confirming.value = true;
  else if (confirming.value) confirming.value = false;
  else emit("close");
}

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
    @close="requestClose"
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
        <div
          v-if="fresh && confirming"
          class="unsaved-warning"
          role="alertdialog"
          aria-labelledby="unsaved-title"
        >
          <p id="unsaved-title">
            This recipe isn’t in your collection yet. Close it now and it’s
            gone.
          </p>
          <div class="unsaved-actions">
            <button class="button small" @click="add">
              <AppIcon name="bookmark" :size="17" />Add to my collection
            </button>
            <button class="text-button" @click="emit('close')">
              Close anyway
            </button>
          </div>
        </div>
        <template v-else-if="fresh">
          <button
            class="button small"
            :disabled="adding"
            @click="add"
          >
            <AppIcon name="bookmark" :size="17" />{{
              adding ? "Adding…" : "Add to my collection"
            }}
          </button>
          <div
            v-if="addFailure"
            role="alert"
            :class="['add-failure', { error: addFailure.action !== 'signIn' }]"
          >
            <p>{{ addFailure.message }}</p>
            <button
              v-if="addFailure.action === 'retry'"
              class="text-button"
              @click="add"
            >
              Try again
            </button>
            <button
              v-else-if="addFailure.action === 'signIn'"
              class="text-button"
              @click="emit('signIn', fresh)"
            >
              Sign in again
            </button>
          </div>
        </template>
        <p
          v-else-if="stored"
          ref="savedNote"
          class="saved-note"
          role="status"
          tabindex="-1"
        >
          <AppIcon name="check" :size="17" />In your collection
        </p>
        <button
          v-else-if="sample"
          class="button small"
          @click="emit('save', sample)"
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
