<script setup lang="ts">
import { importLink } from "#shared/utils/importLink";

// A prefix link or the bookmarklet (#136): `/get/<recipe url>` opens the import
// dialog with that address in it, over the shelf. Nothing is fetched until the
// person sends it, since any page can make a browser load this address. The
// address is read from the browser's own, which the router would split.
const { openImportOf } = useDialogs();
onMounted(() => {
  const { pathname, search, hash } = window.location;
  openImportOf(importLink(pathname.replace(/^\/get\/?/, "") + search + hash));
  navigateTo("/recipes", { replace: true });
});
</script>

<template>
  <p class="collection-state page-width" role="status">Opening the import…</p>
</template>
