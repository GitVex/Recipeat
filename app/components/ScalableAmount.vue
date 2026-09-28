<script setup lang="ts">
// An ingredient's amount on a recipe being read, which can be set: "I have 350
// g of flour, not 500 g". Tapped, it takes a number in the unit it is shown
// in, and the rest of the recipe scales to match. The line it was set on is
// the anchor, and looks it.
const props = defineProps<{
  text: string;
  // The number shown now, to start typing from, and the unit it is in.
  current: number;
  unit: string;
  anchored: boolean;
  name: string;
}>();
const emit = defineEmits<{ set: [value: number] }>();

const active = ref(false);
const input = ref<HTMLInputElement | null>(null);
const draft = ref("");

async function open() {
  draft.value = String(Math.round(props.current * 100) / 100);
  active.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
  if (input.value) revealAboveKeyboard(input.value);
}

function commit() {
  if (!active.value) return;
  active.value = false;
  const value = Number(draft.value.trim().replace(",", "."));
  if (Number.isFinite(value) && value > 0 && value !== props.current) emit("set", value);
}
</script>

<template>
  <span v-if="active" class="scale-input">
    <input
      ref="input"
      v-model="draft"
      class="editable-input amount"
      inputmode="decimal"
      :aria-label="`How much ${name} you have${unit ? `, in ${unit}` : ''}`"
      :size="Math.max(draft.length, 3)"
      @keydown.enter.prevent="commit"
      @keydown.esc.stop.prevent="active = false"
      @blur="commit"
    />
    <span v-if="unit" class="amount">{{ " " }}{{ unit }}</span>
  </span>
  <button
    v-else
    type="button"
    class="amount scalable"
    :class="{ anchored }"
    :aria-label="`Scale to how much ${name} you have: ${text}${anchored ? ', set by you' : ''}`"
    @click="open"
  >
    {{ text }}
  </button>
</template>
