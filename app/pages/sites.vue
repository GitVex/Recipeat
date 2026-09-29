<script setup lang="ts">
// Every site with a reader of its own (#60), for choosing where to import
// from. The list is the fetcher's installed recipe-scrapers, so it is always
// the one the import dialog's hint is checked against.
const { data, error, refresh } = useFetch<{ hosts: string[] }>(
  "/api/extract/sites",
  { key: "supported-sites", retry: 0 },
);
const query = ref("");
const shown = computed(() => {
  const hosts = data.value?.hosts ?? [];
  const needle = query.value.trim().toLowerCase().replace(/^www\./, "");
  return needle ? hosts.filter((host) => host.includes(needle)) : hosts;
});

useHead({ title: "Supported sites — Recipeat" });
</script>

<template>
  <section class="sites-page page-width">
    <div class="eyebrow">IMPORTING FROM THE WEB</div>
    <h1>Supported sites</h1>
    <p>
      We have a reader written for each of these sites, so a recipe from one
      of them comes in reliably. A link from anywhere else still works if the
      page carries recipe markup, as most food blogs do.
    </p>

    <div v-if="error" class="collection-state" role="alert">
      <p>We couldn’t load the list.</p>
      <button class="button" @click="refresh()">Try again</button>
    </div>
    <template v-else-if="data">
      <label class="field-label"
        >Find a site<input
          v-model="query"
          type="search"
          placeholder="bbcgoodfood.com"
      /></label>
      <p role="status" class="sites-count">
        {{ shown.length }} of {{ data.hosts.length }} sites
      </p>
      <ul class="sites-list">
        <li v-for="host in shown" :key="host">{{ host }}</li>
      </ul>
    </template>
    <p v-else class="collection-state" role="status">Loading the list…</p>
  </section>
</template>
