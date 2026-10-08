<script setup lang="ts">
// Crate Label's riso print (#87), as the SVG filter the theme's stylesheet names
// with filter: url(#crate-halftone); built in utils/halftone.ts. Rendered only
// while the theme and its halftone are on: a filter must be in the document.
const primitives = risoPrimitives(CRATE_RISO);
</script>

<template>
  <svg class="halftone-filters" aria-hidden="true" width="0" height="0">
    <filter
      id="crate-halftone"
      x="0"
      y="0"
      width="100%"
      height="100%"
      color-interpolation-filters="sRGB"
      v-html="primitives"
    />
  </svg>
</template>
