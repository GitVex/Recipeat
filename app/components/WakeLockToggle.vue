<script setup lang="ts">
// Keep the screen on while cooking, beside the other switches. Only shown where
// the browser can do it.
const { supported, on, error, toggle } = useWakeLock();
</script>

<template>
  <template v-if="supported">
    <button
      type="button"
      class="unit-toggle wake-toggle"
      role="switch"
      :aria-checked="on"
      aria-label="Keep screen on"
      title="Keep the screen on while you cook"
      @click="toggle"
    >
      <AppIcon name="sun" :size="15" />
      <span :class="{ active: on }" aria-hidden="true">Keep Awake</span>
      <span :class="{ active: !on }" aria-hidden="true">Off</span>
    </button>
    <p v-if="error" role="alert" class="wake-lock-error">{{ error }}</p>
  </template>
</template>
