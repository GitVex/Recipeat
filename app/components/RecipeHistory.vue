<script setup lang="ts">
import type { RecipeHistory, RecipeVersion } from "#shared/types/recipe";
import type { HistoryTree } from "~/utils/recipeHistory";

// A recipe's history on its own page: the straight path from the original
// down to the version on the page, and no more. The whole tree — forks, the
// versions after this one, what branched off as separate recipes — is the
// lineage page, one link away. Folded by default, since the point of the page
// is the recipe, and open from the start on an earlier version, which is the
// one time the reader is already in the history.
const props = defineProps<{
  history: RecipeHistory;
  tree: HistoryTree;
  current: string;
  pinning: string | null;
  pinError: string | null;
  deleting: boolean;
}>();
const emit = defineEmits<{ pin: [id: string]; delete: [id: string] }>();

const path = computed(() => pathTo(props.history, props.current));
const earlier = computed(() => !path.value.at(-1)?.pinned);
const open = ref(earlier.value);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const summary = computed(() => {
  const versions = props.history.versions.length;
  const variants = props.history.variants.length;
  return [
    versions > 1 ? plural(versions, "version") : null,
    variants ? plural(variants, "separate recipe") : null,
  ]
    .filter(Boolean)
    .join(", ");
});
// What the lineage page has that this does not, said so the link is worth
// following — or plainly not, when the path is the whole of it.
const beyond = computed(() => {
  const versions = props.history.versions.length - path.value.length;
  const variants = props.history.variants.length;
  const parts = [
    versions ? plural(versions, "other version") : null,
    variants ? plural(variants, "separate recipe") : null,
  ].filter(Boolean);
  return parts.length ? `The full lineage also has ${parts.join(" and ")}.` : null;
});

const meta = (version: RecipeVersion) =>
  [
    formatSaved(version.createdAt),
    plural(version.ingredientCount, "ingredient"),
    plural(version.stepCount, "step"),
  ].join(" · ");
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
        How this version came to be, from the original. Each version is a whole
        copy: changing one never changes the versions made from it.
      </p>
      <p v-if="pinError" class="edit-bar-problem" role="alert">{{ pinError }}</p>

      <ol class="history-chain" aria-label="From the original to this version">
        <li
          v-for="version in path"
          :key="version.id"
          class="history-version"
          :class="{ current: version.id === current, pinned: version.pinned }"
        >
          <span class="history-dot" aria-hidden="true" />
          <div class="history-row">
            <div class="history-text">
              <span class="history-label">{{ tree.label(version.id) }}</span>
              <span v-if="version.id === current" class="history-title" aria-current="page">
                <span :class="{ untitled: !version.title }">{{ recipeTitle(version) }}</span>
              </span>
              <NuxtLink v-else class="history-title" :to="`/recipes/${version.id}`">
                <span :class="{ untitled: !version.title }">{{ recipeTitle(version) }}</span>
              </NuxtLink>
              <span class="history-meta">{{ meta(version) }}</span>
              <span v-if="changeSummary(version)" class="history-changes">
                <span class="changes-from">Since the original</span>{{ changeSummary(version) }}
              </span>
              <span class="history-tags">
                <span v-if="version.id === current" class="history-tag">Open now</span>
                <span v-if="version.pinned" class="history-tag pinned">
                  <AppIcon name="bookmark" :size="11" />In your collection
                </span>
              </span>
            </div>
            <div class="history-actions">
              <button
                v-if="!version.pinned"
                type="button"
                class="history-action"
                :aria-label="`Pin ${tree.label(version.id)}`"
                title="Show this version in your collection"
                :disabled="!!pinning"
                @click="emit('pin', version.id)"
              >
                <AppIcon name="bookmark" :size="14" />{{ pinning === version.id ? "Pinning…" : "Pin" }}
              </button>
              <button
                type="button"
                class="history-action delete"
                :aria-label="`Delete ${tree.label(version.id)}`"
                title="Delete this version"
                :disabled="deleting"
                @click="emit('delete', version.id)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
        </li>
      </ol>

      <div class="history-more">
        <p v-if="beyond">{{ beyond }}</p>
        <NuxtLink class="button small" :to="`/recipes/${current}/lineage`">
          <AppIcon name="branch" :size="15" />Open the full lineage
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
