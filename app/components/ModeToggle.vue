<script setup lang="ts">
// Reading or editing the recipe: one switch with both written on it, the
// current one lit. Reading is where it can be scaled; editing is where it can
// be changed. Unsaved edits hold it on editing until they are saved or
// discarded — the reading side would show the recipe without them.
defineProps<{ mode: "view" | "edit"; locked: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="unit-toggle mode-toggle"
    role="switch"
    :aria-checked="mode === 'edit'"
    aria-label="Edit recipe"
    :disabled="locked"
    :title="locked ? 'Save or discard your changes to go back to reading' : undefined"
    @click="emit('toggle')"
  >
    <span :class="{ active: mode === 'view' }" aria-hidden="true">View</span>
    <span :class="{ active: mode === 'edit' }" aria-hidden="true">Edit</span>
  </button>
</template>
