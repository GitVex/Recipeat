<script setup lang="ts">
import { importLink } from "#shared/utils/importLink";

// A prefix link or the bookmarklet (#136): `/get/<recipe url>` opens the import
// dialog with that address in it, over the shelf. Nothing is fetched until the
// person sends it, since any page can make a browser load this address. The
// address is read as the server received it: by the time the page mounts the
// router has rewritten the browser's, splitting off the query and turning
// `%20` into `+`. Only the fragment, which never reaches the server, is the
// browser's; reached without a server render, so is the rest.
const { openImportOf } = useDialogs();
const requested = useState("get-request-path", () => useRequestEvent()?.path ?? "");
onMounted(() => {
  const { pathname, search, hash } = window.location;
  const path = requested.value || pathname + search;
  openImportOf(importLink(path.replace(/^\/get\/?/, "") + hash));
  requested.value = "";
  navigateTo("/recipes", { replace: true });
});
</script>

<template>
  <p class="collection-state page-width" role="status">Opening the import…</p>
</template>
