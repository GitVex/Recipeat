<script setup lang="ts">
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import type { LineageNodeData } from "~/utils/lineageLayout";

// A recipe's whole lineage (#31), as a page of its own: every version in its
// line as a tree, the separate recipes that branched off it by their entry
// points, and the recipe it came from. The recipe page shows only the path to
// the version on it; this is where the rest is. Its own route rather than a
// child of the collection, because the tree wants the whole width.
definePageMeta({ path: "/recipes/:id/lineage" });

const route = useRoute();
const id = String(route.params.id);
const { login } = useOidcAuth();

const lineage = useRecipeHistory(id);
const { history, tree, pinning, pinError } = lineage;

const failure = computed(() => {
  const statusCode = lineage.error.value?.statusCode;
  if (!lineage.error.value) return null;
  if (statusCode === 404 || statusCode === 400) return "notFound";
  return failureOf(statusCode);
});

const here = computed(() => history.value?.versions.find((version) => version.id === id) ?? null);

// Deleting from the tree. Taking the version the page is about goes to what
// its line is entered by now, still here; anything else draws the tree again.
const deletion = useRecipeDelete(id, {
  left: (pinned) => navigateTo(pinned ? `/recipes/${pinned}/lineage` : "/recipes"),
  pruned: () => lineage.refresh(),
});
const { deleting, deletePending, deleteError } = deletion;
const deleteWhat = computed(() =>
  versionName(deleting.value && tree.value ? tree.value.label(deleting.value.id) : undefined),
);

// Across, a node's width and a gap. Down, each generation starts below the
// tallest node of the one above it: a node grows with what changed in it,
// so the rows are measured rather than guessed, and a height stands in only
// until Vue Flow has measured them.
const ACROSS = 330;
const GAP = 70;
const GUESS = 220;
const rowHeights = ref<number[]>([]);
const rowTop = (depth: number) => {
  let top = 0;
  for (let row = 0; row < depth; row++) top += (rowHeights.value[row] ?? GUESS) + GAP;
  return top;
};
const layout = computed(() =>
  history.value && tree.value ? layoutLineage(history.value, tree.value) : null,
);
const depthOf = computed(() => new Map((layout.value?.nodes ?? []).map((node) => [nodeKey(node), node.depth])));
const nodes = computed<Node<LineageNodeData>[]>(() =>
  (layout.value?.nodes ?? []).map((node) => ({
    id: nodeKey(node),
    type: "lineage",
    position: { x: node.slot * ACROSS, y: rowTop(node.depth) },
    data: {
      node,
      label: node.kind === "version" ? tree.value!.label(node.id) : null,
      current: node.kind === "version" && node.id === id,
      pinning: pinning.value,
      deleting: deletePending.value,
      pin: (version) => void lineage.pin(version),
      remove: (version) => void deletion.askDelete(version),
    },
    draggable: false,
    connectable: false,
    selectable: false,
  })),
);
const edges = computed<Edge[]>(() =>
  (layout.value?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    class: `lineage-edge ${edge.kind}`,
    markerEnd: MarkerType.ArrowClosed,
  })),
);

// The whole tree when it fits at a size that can be read; otherwise the
// version the reader came from, at that size, with the rest a pan away.
// Fitting a line of thirty to the screen would draw thirty specks.
const READABLE = 0.8;
const flow = useVueFlow("lineage");

// The tallest node in each generation, as drawn. Read again whenever a node
// changes size — a pin moving adds or takes away a tag.
function measure(): boolean {
  const heights: number[] = [];
  for (const node of flow.getNodes.value) {
    const depth = depthOf.value.get(node.id);
    if (depth === undefined) continue;
    heights[depth] = Math.max(heights[depth] ?? 0, node.dimensions.height);
  }
  // Placing them anew hands Vue Flow new nodes, which it measures again from
  // nothing; a pass taken before that is done is not a measurement.
  const generations = Math.max(-1, ...depthOf.value.values()) + 1;
  if (heights.length < generations || heights.some((height) => !height)) return false;
  const same = heights.length === rowHeights.value.length && heights.every((height, row) => height === rowHeights.value[row]);
  if (!same) rowHeights.value = heights;
  return !same;
}
// Watched rather than heard through @nodes-change: listening there tells Vue
// Flow the page will apply every change itself, and it stops recording the
// sizes it measures — the nodes would never count as drawn.
watch(() => flow.getNodes.value.map((node) => node.dimensions.height).join(), () => measure());

async function frame() {
  // Placed by what was measured first, then framed where they now stand.
  if (measure()) await nextTick();
  await flow.fitView({ padding: 0.1, maxZoom: 1 });
  if (flow.viewport.value.zoom >= READABLE) return;
  const here = flow.findNode(nodeKey({ kind: "version", id }));
  if (!here) return;
  await flow.setCenter(
    here.position.x + here.dimensions.width / 2,
    here.position.y + here.dimensions.height / 2,
    { zoom: READABLE },
  );
}

useHead(() => ({
  title: here.value ? `Lineage of ${recipeTitle(here.value)} — Recipeat` : "Lineage — Recipeat",
}));
</script>

<template>
  <section class="lineage">
    <div class="lineage-header page-width">
      <NuxtLink class="text-button lineage-back" :to="`/recipes/${id}`">
        <AppIcon name="arrow" :size="15" class="flip" />Back to the recipe
      </NuxtLink>
      <div>
        <div class="eyebrow">LINEAGE</div>
        <h1 class="lineage-heading" :class="{ untitled: here && !here.title }">
          {{ here ? recipeTitle(here) : "Lineage" }}
        </h1>
      </div>
      <ul v-if="history" class="lineage-legend" aria-label="Key">
        <li><span class="lineage-key pinned" aria-hidden="true" />In your collection: the version your collection shows</li>
        <li><span class="lineage-key current" aria-hidden="true" />The version you came from</li>
        <li><span class="lineage-key variant" aria-hidden="true" />A separate recipe, shown by where it stands now</li>
      </ul>
      <p v-if="pinError" class="edit-bar-problem" role="alert">{{ pinError }}</p>
    </div>

    <div v-if="failure === 'notFound'" class="collection-state page-width" role="alert">
      <h2>We couldn’t find that recipe.</h2>
      <p>It may have been deleted, or the link may be wrong.</p>
      <NuxtLink class="button" to="/recipes">
        Back to your collection <AppIcon name="arrow" />
      </NuxtLink>
    </div>
    <div v-else-if="failure === 'signedOut'" class="collection-state page-width">
      <h2>Sign in to see this recipe’s lineage.</h2>
      <button class="button" @click="login('zitadel')">
        Sign in <AppIcon name="arrow" />
      </button>
    </div>
    <div v-else-if="failure" class="collection-state page-width" role="alert">
      <h2>We couldn’t read this recipe’s lineage.</h2>
      <p v-if="failure === 'unavailable'">Saving isn’t available on this server.</p>
      <button v-else class="button" @click="lineage.refresh()">Try again</button>
    </div>
    <p v-else-if="!history" class="collection-state page-width" role="status">
      Drawing the lineage…
    </p>

    <ClientOnly v-else>
      <div class="lineage-canvas">
        <VueFlow
          id="lineage"
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :elements-selectable="false"
          :zoom-on-double-click="false"
          :min-zoom="0.2"
          :max-zoom="1.5"
          @nodes-initialized="frame"
          aria-label="Lineage tree"
        >
          <template #node-lineage="{ data }">
            <LineageNode :data="data" />
          </template>
          <Background :gap="24" pattern-color="#dcdccf" />
          <Controls :show-interactive="false" position="bottom-right" />
        </VueFlow>
      </div>
    </ClientOnly>

    <DeleteVersionDialog
      :deleting="deleting"
      :what="deleteWhat"
      :pending="deletePending"
      :error="deleteError"
      @confirm="deletion.confirmDelete()"
      @cancel="deletion.cancelDelete()"
    />
  </section>
</template>
