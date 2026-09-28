<script setup lang="ts">
import type { RecipeHistory } from "#shared/types/recipe";
import type { HistoryContext, HistoryTree } from "~/utils/recipeHistory";

// A recipe's history on its own page: every version in its line as a tree,
// what branched off it, and where it came from. Folded away by default — the
// point of the page is the recipe — and open from the start when the recipe on
// the page is an earlier version, which is the one time the reader is already
// in the history.
const props = defineProps<{
  history: RecipeHistory;
  tree: HistoryTree;
  current: string;
  pinning: string | null;
  pinError: string | null;
  deleting: boolean;
}>();
const emit = defineEmits<{ pin: [id: string]; delete: [id: string] }>();

const earlier = computed(
  () => !props.history.versions.find((version) => version.id === props.current)?.pinned,
);
const open = ref(earlier.value);

const summary = computed(() => {
  const versions = props.history.versions.length;
  const variants = props.history.variants.length;
  return [
    versions > 1 ? `${versions} versions` : null,
    variants ? `${variants} separate recipe${variants === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
});

const context = computed<HistoryContext>(() => ({
  tree: props.tree,
  current: props.current,
  pinning: props.pinning,
  deleting: props.deleting,
  pin: (id) => emit("pin", id),
  remove: (id) => emit("delete", id),
}));
</script>

<template>
  <section class="recipe-history" aria-labelledby="history-heading">
    <h2 id="history-heading" class="history-heading">
      <button
        type="button"
        class="history-toggle"
        :aria-expanded="open"
        aria-controls="history-panel"
        @click="open = !open"
      >
        <AppIcon name="history" :size="16" />
        <span>History</span>
        <span v-if="summary" class="history-summary">{{ summary }}</span>
        <AppIcon :name="open ? 'up' : 'down'" :size="16" />
      </button>
    </h2>
    <div v-show="open" id="history-panel" class="history-panel">
      <p v-if="history.origin" class="history-origin">
        <AppIcon name="branch" :size="14" />
        Started as a separate take on
        <NuxtLink :to="`/recipes/${history.origin.id}`" :class="{ untitled: !history.origin.title }">{{
          recipeTitle(history.origin)
        }}</NuxtLink>.
      </p>
      <p class="history-note">
        The version marked <strong>In your collection</strong> is the one your
        collection shows. Each version is a whole copy: changing one never
        changes the versions made from it.
      </p>
      <p v-if="pinError" class="edit-bar-problem" role="alert">{{ pinError }}</p>
      <RecipeHistoryChain :start="tree.root" :context="context" />
    </div>
  </section>
</template>
