<script setup lang="ts">
// Move up, move down, remove: beside each ingredient and step of a recipe
// being edited. Laid over the end of the row, so they take no room from it.
const props = defineProps<{ what: string; index: number; count: number }>();
const emit = defineEmits<{ move: [by: -1 | 1]; remove: [] }>();
const position = computed(() => `${props.what} ${props.index + 1}`);
</script>

<template>
  <span class="row-controls">
    <button
      type="button"
      class="row-control"
      :disabled="index === 0"
      :aria-label="`Move ${position} up`"
      @click="emit('move', -1)"
    >
      <AppIcon name="up" :size="15" />
    </button>
    <button
      type="button"
      class="row-control"
      :disabled="index === count - 1"
      :aria-label="`Move ${position} down`"
      @click="emit('move', 1)"
    >
      <AppIcon name="down" :size="15" />
    </button>
    <button
      type="button"
      class="row-control"
      :aria-label="`Remove ${position}`"
      @click="emit('remove')"
    >
      <AppIcon name="trash" :size="15" />
    </button>
  </span>
</template>
