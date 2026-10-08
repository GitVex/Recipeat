<script setup lang="ts">
import type { PreferenceSpec } from "#shared/utils/preferences";

// One preference on the profile's form (#62): its name and hint, and radios
// for a choice or a box for a number. The form holds text, "" for unset.
defineProps<{ name: string; spec: PreferenceSpec }>();
const value = defineModel<string>({ required: true });
const emit = defineEmits<{ change: [] }>();
</script>

<template>
  <div class="preference-row">
    <div class="preference-key">
      <label
        :id="`preference-${name}-label`"
        :for="spec.kind === 'number' ? `preference-${name}` : undefined"
        class="preference-name"
        >{{ spec.label }}</label
      >
      <span :id="`preference-${name}-hint`" class="preference-hint">{{ spec.description }}</span>
    </div>
    <div
      v-if="spec.kind === 'choice'"
      class="preference-value preference-options"
      role="radiogroup"
      :aria-labelledby="`preference-${name}-label`"
      :aria-describedby="`preference-${name}-hint`"
    >
      <label
        v-for="option in [{ value: '', label: spec.unset }, ...spec.options]"
        :key="option.value"
        class="preference-option"
      >
        <input v-model="value" type="radio" :name="name" :value="option.value" @change="emit('change')" />
        {{ option.label }}
      </label>
    </div>
    <div v-else class="preference-value">
      <input
        :id="`preference-${name}`"
        v-model="value"
        type="number"
        :min="spec.min"
        :max="spec.max"
        step="1"
        :placeholder="spec.unset"
        :aria-describedby="`preference-${name}-hint`"
        @change="emit('change')"
      />
    </div>
  </div>
</template>
