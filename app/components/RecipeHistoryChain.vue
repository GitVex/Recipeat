<script setup lang="ts">
import type { RecipeVersion } from "#shared/types/recipe";
import type { HistoryContext } from "~/utils/recipeHistory";

// A run of versions, each made from the one before, drawn as one column down
// to where the line forks. A fork is a nested list with a chain per branch, so
// a line of thirty progressions is thirty rows at one depth, not thirty
// levels of indent — and the tree is still a tree wherever it is one.
const props = defineProps<{ start: RecipeVersion; context: HistoryContext }>();

const chain = computed(() => {
  const versions = [props.start];
  for (;;) {
    const next = props.context.tree.children.get(versions.at(-1)!.id) ?? [];
    if (next.length !== 1) return { versions, forks: next };
    versions.push(next[0]!);
  }
});

const meta = (version: RecipeVersion) =>
  [
    formatSaved(version.createdAt),
    `${version.ingredientCount} ingredient${version.ingredientCount === 1 ? "" : "s"}`,
    `${version.stepCount} step${version.stepCount === 1 ? "" : "s"}`,
  ].join(" · ");
</script>

<template>
  <ol class="history-chain">
    <li
      v-for="(version, index) in chain.versions"
      :key="version.id"
      class="history-version"
      :class="{ current: version.id === context.current, pinned: version.pinned }"
    >
      <span class="history-dot" aria-hidden="true" />
      <div class="history-row">
        <div class="history-text">
          <span class="history-label">{{ context.tree.label(version.id) }}</span>
          <span v-if="version.id === context.current" class="history-title" aria-current="page">
            <span :class="{ untitled: !version.title }">{{ recipeTitle(version) }}</span>
          </span>
          <NuxtLink v-else class="history-title" :to="`/recipes/${version.id}`">
            <span :class="{ untitled: !version.title }">{{ recipeTitle(version) }}</span>
          </NuxtLink>
          <span class="history-meta">{{ meta(version) }}</span>
          <span class="history-tags">
            <span v-if="version.id === context.current" class="history-tag">Open now</span>
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
            :aria-label="`Pin ${context.tree.label(version.id)}`"
            title="Show this version in your collection"
            :disabled="!!context.pinning"
            @click="context.pin(version.id)"
          >
            <AppIcon name="bookmark" :size="14" />{{ context.pinning === version.id ? "Pinning…" : "Pin" }}
          </button>
          <button
            type="button"
            class="history-action delete"
            :aria-label="`Delete ${context.tree.label(version.id)}`"
            title="Delete this version"
            :disabled="context.deleting"
            @click="context.remove(version.id)"
          >
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
      </div>

      <!-- What branched off here as a recipe of its own: its entry point, and
           none of its history. -->
      <ul v-if="context.tree.variants.get(version.id)" class="history-variants">
        <li v-for="branch in context.tree.variants.get(version.id)" :key="branch.id">
          <AppIcon name="branch" :size="14" />
          <span class="history-variant-kind">Separate recipe</span>
          <NuxtLink :to="`/recipes/${branch.id}`" :class="{ untitled: !branch.title }">{{
            recipeTitle(branch)
          }}</NuxtLink>
        </li>
      </ul>

      <ul
        v-if="index === chain.versions.length - 1 && chain.forks.length"
        class="history-forks"
        :aria-label="`${chain.forks.length} versions made from ${context.tree.label(version.id)}`"
      >
        <li v-for="fork in chain.forks" :key="fork.id">
          <RecipeHistoryChain :start="fork" :context="context" />
        </li>
      </ul>
    </li>
  </ol>
</template>
