<script setup lang="ts">
import type { ExtractedRecipe } from "#shared/types/recipe";
import type { SaveFailure } from "~/composables/useSaveRecipe";
import type { OpenRecipe } from "~/composables/useDialogs";
const props = defineProps<{
  recipe: OpenRecipe | null;
  // Adding a fresh import to the collection.
  adding: boolean;
  addFailure: SaveFailure | null;
}>();
const emit = defineEmits<{
  close: [];
  add: [recipe: ExtractedRecipe];
  signIn: [recipe: ExtractedRecipe];
}>();

// Three kinds of recipe open here. A stored one has a row, and with it a line;
// a sample has an id and no line, and is only here to be looked at; a fresh
// import has neither, and is the only one that can still be lost.
const stored = computed(() =>
  props.recipe && "lineId" in props.recipe ? props.recipe : null,
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
</script>

<template>
  <BaseDialog
    :open="!!recipe"
    title-id="recipe-title"
    close-label="Close recipe"
    modal-class="detail-modal"
    @close="requestClose"
  >
    <RecipeBody v-if="recipe" :recipe="recipe" title-id="recipe-title">
      <div
        v-if="fresh && confirming"
        class="unsaved-warning"
        role="alertdialog"
        aria-labelledby="unsaved-title"
      >
        <p id="unsaved-title">
          This recipe isn’t in your collection yet. Close it now and it’s gone.
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
        <button class="button small" :disabled="adding" @click="add">
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
      <div v-else-if="stored" class="saved-row">
        <p ref="savedNote" class="saved-note" role="status" tabindex="-1">
          <AppIcon name="check" :size="17" />In your collection
        </p>
        <NuxtLink
          class="text-button"
          :to="`/recipes/${stored.id}`"
          @click="emit('close')"
        >
          Open it there <AppIcon name="arrow" :size="16" />
        </NuxtLink>
      </div>
    </RecipeBody>
  </BaseDialog>
</template>
