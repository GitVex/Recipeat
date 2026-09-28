<script setup lang="ts">
import type { CollectionDetail, CollectionEntry } from "#shared/types/collection";

// One collection opened (#72): its recipes in the order the user set, and the
// place to change that order — by dragging, or by the move buttons for anyone
// who cannot drag. Each entry is the version that was added; an earlier one
// says so, and links to the newest.
const route = useRoute();
const id = String(route.params.id);
const { login } = useOidcAuth();
const { notify } = useToast();
const list = useCollectionListCache();
const writes = useCollectionWrites();

const request = useFetch<{ collection: CollectionDetail }>(`/api/collections/${id}`, {
  key: `collection:${id}`,
  retry: 0,
});
const { data, error, status, refresh } = request;
const collection = computed(() => data.value?.collection ?? null);

// Someone else's collection and one that never existed are the same answer
// from the server, and the same page here, as with a recipe.
const failure = computed(() => {
  const statusCode = error.value?.statusCode;
  if (!error.value) return null;
  if (statusCode === 404 || statusCode === 400) return "notFound";
  return failureOf(statusCode);
});
const event = useRequestEvent();
onServerPrefetch(async () => {
  await request;
  if (event && failure.value === "notFound") setResponseStatus(event, 404);
});

useHead(() => ({
  title: collection.value ? `${collection.value.name} — Recipeat` : "Recipeat",
}));

// The order on screen. It moves at once, under a drag or a button, and the
// server is told after; what it answers replaces it.
const entries = ref<CollectionEntry[]>([]);
watch(
  () => collection.value?.recipes,
  (recipes) => (entries.value = recipes ? [...recipes] : []),
  { immediate: true },
);

const problem = ref<string | null>(null);
// Read out after each move, for anyone who cannot see the row travel.
const announcement = ref("");

// The listing's count and first four thumbnails follow what happens here.
const listingChanged = () => {
  if (list.data.value) list.reload().catch(() => {});
};

// ── Order ──────────────────────────────────────────────────────────────────

// One save at a time, in the order they were made: two in flight could
// arrive the wrong way round, and the older order would win.
let saving: Promise<unknown> = Promise.resolve();
function saveOrder() {
  const order = entries.value.map((entry) => entry.id);
  saving = saving.then(async () => {
    try {
      const { collection: saved } = await $fetch<{ collection: CollectionDetail }>(`/api/collections/${id}/order`, {
        method: "PUT",
        body: { recipeIds: order },
        retry: 0,
      });
      // Only the latest order is worth showing; an earlier answer would put
      // back a move made since.
      if (order.join() === entries.value.map((entry) => entry.id).join()) data.value = { collection: saved };
      listingChanged();
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      problem.value =
        statusCode === 409
          ? "This collection changed somewhere else. Here it is as it is now."
          : "The new order couldn’t be saved. Here it is as it was.";
      await refresh();
    }
  });
}

const titleOf = (entry: CollectionEntry) => recipeTitle(entry);
function announce(entry: CollectionEntry) {
  const at = entries.value.indexOf(entry);
  announcement.value = `${titleOf(entry)} moved to ${at + 1} of ${entries.value.length}.`;
}

async function move(index: number, delta: -1 | 1, event: MouseEvent) {
  const to = index + delta;
  if (to < 0 || to >= entries.value.length) return;
  const next = [...entries.value];
  const [entry] = next.splice(index, 1);
  next.splice(to, 0, entry!);
  entries.value = next;
  problem.value = null;
  announce(entry!);
  saveOrder();
  // The row keeps its elements as it moves, so focus goes with it — unless
  // the button pressed has just become the one that cannot move further.
  const button = event.currentTarget as HTMLButtonElement;
  await nextTick();
  if (button.disabled)
    button.parentElement?.querySelector<HTMLButtonElement>(".order-controls button:not(:disabled)")?.focus();
}

// Dragging, by the handle: the row under the pointer takes the place of the
// one being dragged as it passes the middle of it, and the rest slide to make
// room. Saved once, when the row is let go.
const dragging = ref<string | null>(null);
const rows = ref<HTMLElement | null>(null);
let dragStart: string[] = [];

function dragFrom(entry: CollectionEntry, event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging.value = entry.id;
  dragStart = entries.value.map((each) => each.id);
  problem.value = null;
}
function dragOver(event: PointerEvent) {
  if (!dragging.value || !rows.value) return;
  const others = [...rows.value.querySelectorAll<HTMLElement>(".order-row")].filter(
    (row) => row.dataset.id !== dragging.value,
  );
  // How many of the other rows the pointer is below the middle of.
  const to = others.filter((row) => {
    const box = row.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  }).length;
  const from = entries.value.findIndex((entry) => entry.id === dragging.value);
  if (from === to) return;
  const next = [...entries.value];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  entries.value = next;
}
function dragEnd() {
  const id = dragging.value;
  dragging.value = null;
  if (!id) return;
  if (entries.value.map((entry) => entry.id).join() === dragStart.join()) return;
  announce(entries.value.find((entry) => entry.id === id)!);
  saveOrder();
}

// ── Taking one out ─────────────────────────────────────────────────────────

async function takeOut(entry: CollectionEntry, index: number) {
  problem.value = null;
  entries.value = entries.value.filter((each) => each.id !== entry.id);
  try {
    await $fetch(`/api/collections/${id}/recipes/${entry.id}`, { method: "DELETE", retry: 0 });
    if (data.value)
      data.value = {
        collection: { ...data.value.collection, recipes: data.value.collection.recipes.filter((each) => each.id !== entry.id) },
      };
    notify(`${titleOf(entry)} is out of this collection, and still in My recipes`);
    listingChanged();
  } catch {
    const next = [...entries.value];
    next.splice(index, 0, entry);
    entries.value = next;
    problem.value = `${titleOf(entry)} couldn’t be taken out. Try again.`;
  }
  // Focus goes to what took its place, or to the list's end — not to the row
  // that is still fading out.
  await nextTick();
  const rowsLeft = rows.value?.querySelectorAll<HTMLElement>(".order-row:not(.reorder-leave-active) .order-link");
  rowsLeft?.[Math.min(index, rowsLeft.length - 1)]?.focus();
}

// ── Renaming and deleting the collection ───────────────────────────────────

const renaming = ref(false);
const renameTo = ref("");
const renamePending = ref(false);
const renameProblem = ref<string | null>(null);
const renameInput = ref<HTMLInputElement | null>(null);
const renameButton = ref<HTMLButtonElement | null>(null);

async function startRename() {
  if (!collection.value) return;
  renaming.value = true;
  renameTo.value = collection.value.name;
  renameProblem.value = null;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}
async function stopRename() {
  renaming.value = false;
  renameProblem.value = null;
  await nextTick();
  renameButton.value?.focus();
}
async function rename() {
  const name = renameTo.value.trim();
  if (!collection.value || renamePending.value) return;
  if (name === collection.value.name) return stopRename();
  renamePending.value = true;
  renameProblem.value = null;
  try {
    const renamed = await writes.rename(id, name);
    if (data.value) data.value = { collection: { ...data.value.collection, name: renamed.name, updatedAt: renamed.updatedAt } };
    await stopRename();
  } catch (error) {
    renameProblem.value = collectionNameProblem((error as { statusCode?: number }).statusCode, name);
  } finally {
    renamePending.value = false;
  }
}

const confirmingDelete = ref(false);
const deletePending = ref(false);
const deleteProblem = ref<string | null>(null);
const deleteActions = ref<HTMLElement | null>(null);
const deleteButton = ref<HTMLButtonElement | null>(null);

watch(confirmingDelete, async (value, previous) => {
  deleteProblem.value = null;
  await nextTick();
  if (value) deleteActions.value?.querySelector<HTMLElement>(".keep")?.focus();
  else if (previous && !deletePending.value) deleteButton.value?.focus();
});

async function confirmDelete() {
  const name = collection.value?.name ?? "";
  deletePending.value = true;
  try {
    await writes.remove(id);
  } catch {
    deleteProblem.value = "It couldn’t be deleted. Try again.";
    deletePending.value = false;
    return;
  }
  confirmingDelete.value = false;
  notify(`“${name}” is gone. Its recipes are still in My recipes`);
  await navigateTo("/collections");
}

const meta = (entry: CollectionEntry) =>
  [
    formatMinutes(entry.totalTime),
    entry.portions ? `Serves ${entry.portions}` : null,
    `${entry.ingredientCount} ingredient${entry.ingredientCount === 1 ? "" : "s"}`,
  ].filter(Boolean);
const recipesIn = (n: number) => `${n} recipe${n === 1 ? "" : "s"}`;
</script>

<template>
  <section class="collection-page page-width">
    <NuxtLink class="collection-back" to="/collections">
      <AppIcon name="arrow" :size="14" />All collections
    </NuxtLink>

    <div v-if="failure === 'notFound'" class="collection-state" role="alert">
      <h2>We couldn’t find that collection.</h2>
      <p>It may have been deleted, or the link may be wrong.</p>
      <NuxtLink class="button" to="/collections">
        Back to your collections <AppIcon name="arrow" />
      </NuxtLink>
    </div>
    <div v-else-if="failure === 'signedOut'" class="collection-state">
      <h2>Sign in to open this collection.</h2>
      <button class="button" @click="login('zitadel')">
        Sign in <AppIcon name="arrow" />
      </button>
    </div>
    <div v-else-if="failure" class="collection-state" role="alert">
      <h2>We couldn’t open this collection.</h2>
      <p v-if="failure === 'unavailable'">
        Saving isn’t available on this server, so there are no collections to open.
      </p>
      <button v-else class="button" @click="refresh()">Try again</button>
    </div>

    <template v-else-if="collection">
      <div class="collections-heading collection-page-heading">
        <div class="collection-page-title">
          <div class="eyebrow">COLLECTION · {{ recipesIn(entries.length).toUpperCase() }}</div>
          <form
            v-if="renaming"
            class="collection-rename collection-page-rename"
            @submit.prevent="rename"
            @keydown.esc.stop="stopRename"
          >
            <label class="visually-hidden" for="collection-rename">New name for {{ collection.name }}</label>
            <input id="collection-rename" ref="renameInput" v-model="renameTo" type="text" maxlength="80" autocomplete="off" />
            <div class="collection-card-actions">
              <button type="submit" class="text-button" :disabled="!renameTo.trim() || renamePending">
                {{ renamePending ? "Saving…" : "Save" }}
              </button>
              <button type="button" class="text-button" @click="stopRename">Cancel</button>
            </div>
            <p v-if="renameProblem" class="edit-bar-problem" role="alert">{{ renameProblem }}</p>
          </form>
          <h1 v-else>{{ collection.name }}</h1>
        </div>
        <div v-if="!renaming" class="collection-card-actions collection-page-actions">
          <button ref="renameButton" type="button" class="text-button" @click="startRename">Rename</button>
          <button ref="deleteButton" type="button" class="text-button delete-recipe" @click="confirmingDelete = true">
            Delete collection
          </button>
        </div>
      </div>

      <p v-if="problem" class="edit-bar-problem collection-page-problem" role="alert">{{ problem }}</p>
      <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>

      <div v-if="!entries.length" class="collection-state">
        <AppIcon name="bookmark" :size="32" />
        <h2>Nothing in here yet.</h2>
        <p>Open a recipe and add it from there, or from its entry in My recipes.</p>
        <NuxtLink class="button" to="/recipes">
          Go to My recipes <AppIcon name="arrow" />
        </NuxtLink>
      </div>

      <div v-else ref="rows" class="collection-order-wrap">
        <TransitionGroup tag="ol" name="reorder" class="collection-order" aria-label="Recipes in this collection">
          <li
            v-for="(entry, index) in entries"
            :key="entry.id"
            :data-id="entry.id"
            class="order-row"
            :class="{ dragging: dragging === entry.id }"
          >
            <!-- For a pointer: the buttons are the keyboard's way to move it. -->
            <span
              class="order-handle"
              aria-hidden="true"
              title="Drag to reorder"
              @pointerdown="dragFrom(entry, $event)"
              @pointermove="dragOver"
              @pointerup="dragEnd"
              @pointercancel="dragEnd"
            >
              <AppIcon name="menu" :size="16" />
            </span>
            <NuxtLink class="order-link" :to="`/recipes/${entry.id}`" draggable="false">
              <RecipeThumb :image="entry.image" :title="entry.title" />
              <span class="entry-text">
                <span class="entry-title" :class="{ untitled: !entry.title }">{{ titleOf(entry) }}</span>
                <span class="entry-meta">{{ meta(entry).join(" · ") }}</span>
              </span>
            </NuxtLink>
            <span v-if="!entry.pinned && entry.pinnedId" class="order-earlier">
              Earlier version
              <NuxtLink :to="`/recipes/${entry.pinnedId}`">See the newest</NuxtLink>
            </span>
            <span class="order-controls">
              <button
                type="button"
                class="icon-button"
                :aria-label="`Move ${titleOf(entry)} up`"
                title="Move up"
                :disabled="index === 0"
                @click="move(index, -1, $event)"
              >
                <AppIcon name="up" :size="16" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="`Move ${titleOf(entry)} down`"
                title="Move down"
                :disabled="index === entries.length - 1"
                @click="move(index, 1, $event)"
              >
                <AppIcon name="down" :size="16" />
              </button>
              <button
                type="button"
                class="icon-button order-remove"
                :aria-label="`Take ${titleOf(entry)} out of this collection`"
                title="Take out of this collection"
                @click="takeOut(entry, index)"
              >
                <AppIcon name="close" :size="15" />
              </button>
            </span>
          </li>
        </TransitionGroup>
      </div>
    </template>

    <p v-else-if="status === 'pending'" class="collection-state" role="status">
      Opening your collection…
    </p>

    <BaseDialog
      :open="confirmingDelete"
      title-id="delete-collection-title"
      close-label="Close"
      modal-class="leave-modal"
      @close="confirmingDelete = false"
    >
      <div class="leave-content">
        <h2 id="delete-collection-title">Delete “{{ collection?.name }}”?</h2>
        <p>
          <template v-if="entries.length">
            The {{ recipesIn(entries.length) }} in it stay in My recipes. Only the
            collection goes.
          </template>
          <template v-else>It’s empty, so only its name goes.</template>
        </p>
        <p v-if="deleteProblem" class="edit-bar-problem" role="alert">{{ deleteProblem }}</p>
        <div ref="deleteActions" class="leave-actions">
          <button type="button" class="button small destructive" :disabled="deletePending" @click="confirmDelete">
            {{ deletePending ? "Deleting…" : "Delete collection" }}
          </button>
          <button type="button" class="text-button keep" @click="confirmingDelete = false">Keep it</button>
        </div>
      </div>
    </BaseDialog>
  </section>
</template>
