<script setup lang="ts">
// A recipe's tags as they read wherever the recipe is shown and not being
// tagged: the list, the preview, a card. Nothing at all when it has none.
// Spans with list roles rather than a <ul>, so it can sit inside a link's
// text as well as on its own.
defineProps<{ tags: string[] | undefined }>();
</script>

<template>
  <span v-if="tags?.length" class="tag-list" role="list" aria-label="Tags">
    <span v-for="tag in tags" :key="tag" class="tag" role="listitem">{{ tag }}</span>
  </span>
</template>
