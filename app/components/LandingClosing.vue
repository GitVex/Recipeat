<script setup lang="ts">
const emit = defineEmits<{ import: [] }>();
</script>

<template>
  <section class="closing page-width">
    <div class="closing-doodle"><AppIcon name="leaf" :size="56" /></div>
    <div>
      <div class="eyebrow">GOOD THINGS ARE WORTH KEEPING</div>
      <h2>
        Your taste. Your recipes. <em>Your little collection.</em><br />Let’s
        make something good.
      </h2>
    </div>
    <button class="button" @click="emit('import')">
      Start collecting <AppIcon name="arrow" :size="18" />
    </button>
  </section>
</template>
