<script setup lang="ts">
import type { IngredientAnswer, IngredientQuestion } from "~/composables/useIngredientQuestions";

// A line's open question (#173), as a small mark after it. The mark opens a
// bubble under the line with the candidates and the answers; Escape, or
// focus leaving it, closes it again.
const props = defineProps<{
  question: IngredientQuestion;
  knownLanguage: boolean;
  answering: boolean;
  failed: boolean;
}>();
const emit = defineEmits<{ answer: [answer: IngredientAnswer, ingredientId?: string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const mark = ref<HTMLButtonElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
const id = useId();
// Where the tail sits: under the mark, in the line's width.
const tail = ref("0px");

async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  const line = root.value?.closest("li");
  if (line && mark.value) {
    tail.value = `${mark.value.getBoundingClientRect().left - line.getBoundingClientRect().left + mark.value.offsetWidth / 2}px`;
  }
  await nextTick();
  bubble.value?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
}
function close() {
  open.value = false;
  mark.value?.focus();
}
function leave(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) open.value = false;
}
</script>

<template>
  <span ref="root" class="ingredient-check" @focusout="leave" @keydown.esc="close">
    <button
      ref="mark"
      type="button"
      class="ingredient-mark"
      :aria-label="`Check “${question.name}”`"
      :aria-expanded="open"
      :aria-controls="id"
      @click="toggle"
    >
      !
    </button>
    <span
      v-if="open"
      :id="id"
      ref="bubble"
      class="ingredient-bubble"
      role="dialog"
      :aria-label="`Your “${question.name}”`"
      :style="{ '--tail': tail }"
    >
      <span class="ingredient-bubble-title">Does “{{ question.name }}” mean…</span>
      <span
        v-for="candidate in question.candidates"
        :key="candidate.ingredientId"
        class="ingredient-candidate"
        role="group"
        :aria-label="candidate.name"
      >
        <strong>{{ candidate.name }}?</strong>
        <button
          v-if="knownLanguage"
          type="button"
          class="text-button"
          :disabled="answering"
          @click="emit('answer', 'alias', candidate.ingredientId)"
        >
          Same thing, my name
        </button>
        <button
          type="button"
          class="text-button"
          :disabled="answering"
          @click="emit('answer', 'typo', candidate.ingredientId)"
        >
          Typo
        </button>
      </span>
      <button
        v-if="knownLanguage"
        type="button"
        class="text-button"
        :disabled="answering"
        @click="emit('answer', 'none')"
      >
        None of these
      </button>
      <span v-if="failed" role="alert">That didn’t save. Try again.</span>
    </span>
  </span>
</template>
