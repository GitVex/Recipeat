<script setup lang="ts">
import type { Snippet } from "#shared/types/recipe";

// A few words either side of a change, with what went struck through and
// what came in marked: "… blanch them for ~~30~~ 45 seconds, then …". The
// spaces are part of the strings: whitespace at the edge of a template
// element is the compiler's to drop.
const props = defineProps<{ snippet: Snippet }>();
const lead = computed(() => (props.snippet.before ? `${props.snippet.before} ` : ""));
const between = computed(() => (props.snippet.removed && props.snippet.added ? " " : ""));
const trail = computed(() => (props.snippet.after ? ` ${props.snippet.after}` : ""));
</script>

<template>
  <span class="snippet">{{ lead }}<del v-if="snippet.removed">{{ snippet.removed }}</del>{{ between }}<ins v-if="snippet.added">{{ snippet.added }}</ins>{{ trail }}</span>
</template>
