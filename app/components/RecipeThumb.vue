<script setup lang="ts">
// A recipe's picture, or a deliberate stand-in for one: most recipes come from
// a photo of a page or a pasted note, and have no picture of the dish at all.
// The stand-in is the title's first letter, or a book when there is no title.
const props = defineProps<{ image: string | null; title: string | null }>();
const initial = computed(() => props.title?.trim().charAt(0) ?? "");
</script>

<template>
  <span class="recipe-thumb" :class="{ blank: !image }">
    <img v-if="image" :src="image" alt="" loading="lazy" />
    <span v-else-if="initial" class="thumb-initial" aria-hidden="true">{{
      initial
    }}</span>
    <AppIcon v-else name="book" :size="22" />
  </span>
</template>
