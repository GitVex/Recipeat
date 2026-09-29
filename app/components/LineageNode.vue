<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { LineageNodeData } from "~/utils/lineageLayout";
import { changeHeadline, unlisted } from "~/utils/recipeHistory";

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
// Itemised here, where there is room to grow downwards: which ingredient and
// by how much, which step and the words that changed in it.
const changes = computed(() => version.value?.changes ?? null);
const headline = computed(() => (changes.value ? changeHeadline(changes.value) : null));
const STEP: Record<"added" | "removed" | "changed", string> = {
  added: "added",
  removed: "removed",
  changed: "",
};
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
    <Handle id="top" type="target" :position="Position.Top" :connectable="false" />
    <Handle id="left" type="target" :position="Position.Left" :connectable="false" />
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
    <div v-if="changes" class="lineage-changes">
      <span class="changes-from">Since the original</span>
      <p v-if="headline" class="change-headline">{{ headline }}</p>

      <ul v-if="changes.ingredients.items.length" class="change-list" aria-label="Ingredients that changed">
        <li
          v-for="(item, index) in changes.ingredients.items"
          :key="index"
          class="change"
          :class="item.kind"
        >
          <span class="change-mark" aria-hidden="true">{{
            item.kind === "added" ? "+" : item.kind === "removed" ? "−" : "~"
          }}</span>
          <span v-if="item.kind === 'added'" class="change-text"
            ><span class="visually-hidden">Added: </span>{{ item.text }}</span
          >
          <span v-else-if="item.kind === 'removed'" class="change-text"
            ><span class="visually-hidden">Removed: </span><del>{{ item.text }}</del></span
          >
          <span v-else class="change-text">
            <strong class="change-name">{{ item.name }}</strong>
            <span v-if="item.amount" class="change-amount"
              ><del>{{ item.amount.from ?? "no amount" }}</del>{{ " → "
              }}<ins>{{ item.amount.to ?? "no amount" }}</ins
              ><span v-if="item.amount.by" class="change-by">{{ item.amount.by }}</span></span
            >
            <ChangeSnippet v-else-if="item.snippet" :snippet="item.snippet" />
          </span>
        </li>
        <li v-if="unlisted(changes.ingredients)" class="change-more">
          and {{ unlisted(changes.ingredients) }} more
        </li>
      </ul>

      <ul v-if="changes.steps.items.length" class="change-list" aria-label="Steps that changed">
        <li
          v-for="(item, index) in changes.steps.items"
          :key="index"
          class="change step"
          :class="item.kind"
        >
          <span class="change-step">Step {{ item.number }}<template v-if="STEP[item.kind]"> {{ STEP[item.kind] }}</template></span>
          <ChangeSnippet class="change-text" :snippet="item.snippet" />
        </li>
        <li v-if="unlisted(changes.steps)" class="change-more">
          and {{ unlisted(changes.steps) }} more
        </li>
      </ul>
    </div>
    <span v-if="version && (data.current || version.pinned)" class="history-tags">
      <span v-if="data.current" class="history-tag">You came from here</span>
      <span v-if="version.pinned" class="history-tag pinned">
        <AppIcon name="bookmark" :size="11" />In your recipes
      </span>
    </span>
    <div v-if="version" class="lineage-actions nodrag nopan">
      <button
        v-if="!version.pinned"
        type="button"
        class="history-action"
        :aria-label="`Pin ${data.label}`"
        title="Show this version in your recipes"
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
    <Handle id="bottom" type="source" :position="Position.Bottom" :connectable="false" />
    <Handle id="right" type="source" :position="Position.Right" :connectable="false" />
  </div>
</template>
