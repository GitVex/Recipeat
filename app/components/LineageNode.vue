<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { LineageNodeData } from "~/utils/lineageLayout";

// One node of the lineage page's tree. A version of this line can be opened,
// pinned and deleted from here; a separate recipe and the recipe this line
// came from are only somewhere to go, since their histories are their own.
const props = defineProps<{ data: LineageNodeData }>();
const node = computed(() => props.data.node);
const title = computed(() => {
  const n = node.value;
  return n.kind === "version" ? n.version.title : n.kind === "variant" ? n.branch.title : n.origin.title;
});
const version = computed(() => (node.value.kind === "version" ? node.value.version : null));
const meta = computed(() => {
  const v = version.value;
  if (!v) return null;
  return [
    formatSaved(v.createdAt),
    `${v.ingredientCount} ingredient${v.ingredientCount === 1 ? "" : "s"}`,
    `${v.stepCount} step${v.stepCount === 1 ? "" : "s"}`,
  ].join(" · ");
});
const eyebrow = computed(() =>
  node.value.kind === "variant"
    ? "Separate recipe"
    : node.value.kind === "origin"
      ? "Branched off"
      : props.data.label,
);
</script>

<template>
  <div
    class="lineage-node"
    :class="[
      node.kind,
      { current: data.current, pinned: version?.pinned },
    ]"
    role="group"
    :aria-label="`${eyebrow}: ${recipeTitle({ title })}`"
  >
    <Handle type="target" :position="Position.Top" :connectable="false" />
    <span class="lineage-eyebrow">
      <AppIcon v-if="node.kind !== 'version'" name="branch" :size="12" />{{ eyebrow }}
    </span>
    <NuxtLink
      class="lineage-title nodrag"
      :to="`/recipes/${node.id}`"
      :aria-current="data.current ? 'page' : undefined"
      :class="{ untitled: !title }"
      >{{ recipeTitle({ title }) }}</NuxtLink
    >
    <span v-if="meta" class="lineage-meta">{{ meta }}</span>
    <span v-if="version && (data.current || version.pinned)" class="history-tags">
      <span v-if="data.current" class="history-tag">You came from here</span>
      <span v-if="version.pinned" class="history-tag pinned">
        <AppIcon name="bookmark" :size="11" />In your collection
      </span>
    </span>
    <div v-if="version" class="lineage-actions nodrag nopan">
      <button
        v-if="!version.pinned"
        type="button"
        class="history-action"
        :aria-label="`Pin ${data.label}`"
        title="Show this version in your collection"
        :disabled="!!data.pinning"
        @click="data.pin(version.id)"
      >
        <AppIcon name="bookmark" :size="14" />{{ data.pinning === version.id ? "Pinning…" : "Pin" }}
      </button>
      <button
        type="button"
        class="history-action delete"
        :aria-label="`Delete ${data.label}`"
        title="Delete this version"
        :disabled="data.deleting"
        @click="data.remove(version.id)"
      >
        <AppIcon name="trash" :size="14" />
      </button>
    </div>
    <Handle type="source" :position="Position.Bottom" :connectable="false" />
  </div>
</template>
