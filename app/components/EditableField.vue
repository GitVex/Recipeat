<script setup lang="ts">
// A piece of a recipe that reads as text until it is tapped, and is then
// typed into where it stands, in the same type. There is no edit mode to enter:
// every editable field on the page works this way, one at a time.
const props = defineProps<{
  modelValue: string;
  // Names the field for a screen reader: "Edit title: Focaccia".
  label: string;
  // Shown when empty, in a way that reads as missing rather than written.
  placeholder: string;
  maxlength?: number;
  multiline?: boolean;
  invalid?: boolean;
  inputmode?: "text" | "decimal" | "numeric";
  // Open for typing as soon as it appears: a step just added.
  autofocus?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const active = ref(false);
const input = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

// A textarea grows with its text where the browser cannot size it itself.
function fit() {
  const element = input.value;
  if (!(element instanceof HTMLTextAreaElement)) return;
  // field-sizing does it exactly; scrollHeight rounds to a whole pixel.
  if (CSS.supports("field-sizing", "content")) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

async function activate() {
  active.value = true;
  await nextTick();
  const element = input.value;
  if (!element) return;
  element.focus();
  element.setSelectionRange(element.value.length, element.value.length);
  fit();
  revealAboveKeyboard(element);
}

function update(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
  fit();
}

onMounted(() => {
  if (props.autofocus) activate();
});

// Near a limit, say how near; the field stops accepting past it.
const nearLimit = computed(
  () => !!props.maxlength && props.modelValue.length >= props.maxlength * 0.9,
);
</script>

<template>
  <span class="editable-field" :class="{ active }">
    <textarea
      v-if="active && multiline"
      ref="input"
      class="editable-input"
      rows="1"
      :value="modelValue"
      :maxlength="maxlength"
      :aria-label="label"
      :aria-invalid="invalid || undefined"
      :placeholder="placeholder"
      @input="update"
      @blur="active = false"
      @keydown.esc.stop.prevent="active = false"
    />
    <input
      v-else-if="active"
      ref="input"
      class="editable-input"
      :value="modelValue"
      :maxlength="maxlength"
      :aria-label="label"
      :aria-invalid="invalid || undefined"
      :placeholder="placeholder"
      :inputmode="inputmode"
      :size="Math.max(modelValue.length, placeholder.length, 3)"
      @input="update"
      @blur="active = false"
      @keydown.enter.prevent="active = false"
      @keydown.esc.stop.prevent="active = false"
    />
    <span
      v-else
      class="editable"
      :class="{ empty: !modelValue.trim(), invalid }"
      role="button"
      tabindex="0"
      :aria-label="`Edit ${label}: ${modelValue.trim() || placeholder}`"
      @click="activate"
      @keydown.enter.prevent="activate"
      @keydown.space.prevent="activate"
      ><slot v-if="modelValue.trim()">{{ modelValue }}</slot
      ><template v-else>{{ placeholder }}</template></span
    >
    <small v-if="active && nearLimit" class="field-count" aria-live="polite"
      >{{ modelValue.length }} / {{ maxlength }}</small
    >
  </span>
</template>
