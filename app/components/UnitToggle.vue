<script setup lang="ts">
import type { UnitSystem } from "#shared/utils/recipeText";

// One switch with both systems written on it, the current one lit.
defineProps<{ system: UnitSystem }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="unit-toggle"
    role="switch"
    :aria-checked="system === 'metric'"
    aria-label="Metric units"
    @click="emit('toggle')"
  >
    <span :class="{ active: system === 'imperial' }" aria-hidden="true">US</span>
    <span :class="{ active: system === 'metric' }" aria-hidden="true">Met</span>
  </button>
</template>
