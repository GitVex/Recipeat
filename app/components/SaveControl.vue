<script setup lang="ts">
import type { EditProblem } from "#shared/utils/recipeDraft";
import type { SaveAction } from "~/composables/useRecipeWrites";

// Where an edit goes: the three ways to save, as a choice made before the one
// button that does it. They are not equal and are not laid out as if they
// were. Two of them keep the recipe as it was and add to it; overwriting is
// the one that loses something, and says so while it is being chosen, not
// after. The words carry the difference, so nobody has to know what a
// "progression" is to pick the right one.

defineProps<{
  problems: EditProblem[];
  // What is being written right now, if anything.
  saving: SaveAction | null;
  error: string | null;
  canSave: boolean;
}>();
const choice = defineModel<SaveAction>({ required: true });
const emit = defineEmits<{ save: [action: SaveAction]; discard: [] }>();

const OPTIONS: { value: SaveAction; title: string; term: string; detail: string }[] = [
  {
    value: "progression",
    title: "New version",
    term: "progression",
    detail: "The same recipe, further along. This one stays in its history; the new one is what My recipes shows.",
  },
  {
    value: "variant",
    title: "Separate recipe",
    term: "variant",
    detail: "A different take that starts from this one. This one stays exactly as it is.",
  },
  {
    value: "overwrite",
    title: "Overwrite this version",
    term: "save",
    detail: "Replaces it. What it said before is gone.",
  },
];

const LABEL: Record<SaveAction, [idle: string, busy: string]> = {
  progression: ["Save as new version", "Saving new version…"],
  variant: ["Save as separate recipe", "Saving separate recipe…"],
  overwrite: ["Overwrite", "Overwriting…"],
};
</script>

<template>
  <div class="edit-bar" role="region" aria-label="Unsaved changes">
    <div class="edit-bar-text">
      <p class="edit-bar-title"><span class="unsaved-dot" aria-hidden="true" />Unsaved changes</p>
      <p v-for="problem in problems" :key="problem" class="edit-bar-problem">
        {{ EDIT_PROBLEM[problem] }}
      </p>
      <p v-if="error" class="edit-bar-problem" role="alert">{{ error }}</p>
    </div>
    <fieldset class="save-choice" :disabled="!!saving">
      <legend>Save as</legend>
      <label
        v-for="option in OPTIONS"
        :key="option.value"
        class="save-option"
        :class="{ chosen: choice === option.value, destructive: option.value === 'overwrite' }"
      >
        <input v-model="choice" type="radio" name="save-action" :value="option.value" />
        <span class="save-option-text">
          <span class="save-option-title"
            >{{ option.title }} <small>{{ option.term }}</small></span
          >
          <span class="save-option-detail">{{ option.detail }}</span>
        </span>
      </label>
    </fieldset>
    <div class="edit-bar-actions">
      <button type="button" class="text-button" :disabled="!!saving" @click="emit('discard')">
        Discard
      </button>
      <button
        type="button"
        class="button small"
        :class="{ destructive: choice === 'overwrite' }"
        :disabled="!!saving || !canSave"
        :aria-busy="!!saving || undefined"
        @click="emit('save', choice)"
      >
        {{ LABEL[choice][saving === choice ? 1 : 0] }}
      </button>
    </div>
  </div>
</template>
