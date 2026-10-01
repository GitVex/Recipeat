<script setup lang="ts">
import type { SimilarRecipe } from "#shared/types/recipe";

// Three links to recipes like this one elsewhere on the web (#59). Folded by
// default, and searched the first time it is opened rather than on page load,
// so a search is only spent on someone who asked for it. Links out only:
// worth keeping is imported the usual way.
const props = defineProps<{ recipeId: string }>();

const open = ref(false);
const results = ref<SimilarRecipe[] | null>(null);
const failed = ref(false);
const pending = ref(false);

async function search() {
  pending.value = true;
  failed.value = false;
  try {
    ({ results: results.value } = await $fetch<{ results: SimilarRecipe[] }>(
      `/api/recipes/${props.recipeId}/similar`,
      { retry: 0 },
    ));
  } catch {
    failed.value = true;
  } finally {
    pending.value = false;
  }
}

function toggle() {
  open.value = !open.value;
  if (open.value && !results.value && !pending.value) search();
}
</script>

<template>
  <section class="similar-recipes" aria-labelledby="similar-heading">
    <h2 id="similar-heading" class="history-heading">
      <button
        type="button"
        class="history-toggle"
        :aria-expanded="open"
        aria-controls="similar-panel"
        @click="toggle"
      >
        <AppIcon name="search" :size="16" />
        <span>Similar recipes elsewhere</span>
        <span class="history-summary">powered by SearXNG</span>
        <AppIcon :name="open ? 'up' : 'down'" :size="16" />
      </button>
    </h2>
    <div v-show="open" id="similar-panel" class="history-panel" aria-live="polite">
      <p v-if="pending" class="history-note" role="status">Searching the web…</p>
      <p v-else-if="failed" class="history-note">
        The search didn’t work this time.
        <button type="button" class="text-button" @click="search">Try again</button>
      </p>
      <p v-else-if="results && !results.length" class="history-note">
        Nothing similar turned up.
      </p>
      <ul v-else-if="results" class="similar-list">
        <li v-for="result in results" :key="result.url">
          <a class="similar-card" :href="result.url" target="_blank" rel="noopener noreferrer">
            <span class="similar-title">{{ result.title }}</span>
            <span class="similar-site">{{ result.site }}</span>
            <span v-if="result.snippet" class="similar-snippet">{{ result.snippet }}</span>
          </a>
        </li>
      </ul>
    </div>
  </section>
</template>
