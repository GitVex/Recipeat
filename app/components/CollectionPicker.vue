<script setup lang="ts">
import type { CollectionSummary } from "#shared/types/collection";

// Which collections a version is in, one tick each: ticking adds it and
// unticking takes it out, so a recipe can be in as many as it likes. A new
// collection can be made here, and the recipe goes straight into it.
//
// It adds the version on screen, not its line, and a collection keeps showing
// that version after a newer one is saved (#67). On an earlier version it
// says so, before anything is ticked.
const { target, close } = useCollectionPicker();
const list = useCollectionListCache();
const recipes = useRecipeListCache();
// Whether anything was ticked, unticked or made since it opened. If so, the
// filled bookmarks (#128) on the recipe list and page are read again on close.
let changed = false;

const collections = ref<CollectionSummary[]>([]);
const ticked = ref(new Set<string>());
const loading = ref(false);
const loadFailed = ref(false);
// A collection whose tick is on its way to the server: it cannot be ticked
// again until the answer is in. Busy rather than disabled, because disabling
// the box under a keyboard user's focus drops that focus out of the dialog.
const pending = ref(new Set<string>());
const problem = ref<string | null>(null);

const newName = ref("");
const creating = ref(false);

// Read afresh each time it opens: another tab, or the collections page, may
// have changed what is ticked since.
async function load() {
  const recipe = target.value;
  if (!recipe) return;
  loading.value = true;
  loadFailed.value = false;
  problem.value = null;
  try {
    const [listing, containing] = await Promise.all([
      list.reload(),
      $fetch<{ collections: string[] }>(`/api/recipes/${recipe.id}/collections`, { retry: 0 }),
    ]);
    // Closed, or opened for another recipe, while the reads were out.
    if (target.value !== recipe) return;
    collections.value = listing.collections;
    ticked.value = new Set(containing.collections);
  } catch {
    if (target.value === recipe) loadFailed.value = true;
  } finally {
    if (target.value === recipe) loading.value = false;
  }
}

watch(target, (value, before) => {
  if (!value && before && changed) {
    void recipes.relist();
    void refreshNuxtData(`recipe-collections:${before.id}`);
  }
  changed = false;
  newName.value = "";
  pending.value = new Set();
  if (value) load();
});

const messageFor = (status: number | undefined, adding: boolean) => {
  if (status === 404) return adding ? "That recipe or collection is gone. Close this and try again." : "That collection is gone.";
  if (status === 401) return "Your session ended. Sign in again to change your collections.";
  return adding ? "It couldn’t be added. Try again." : "It couldn’t be taken out. Try again.";
};

// The tick moves at once and goes back if the server says no, so a slow
// answer does not look like a click that missed.
async function toggle(collection: CollectionSummary, event: Event) {
  const recipe = target.value;
  if (!recipe || pending.value.has(collection.id)) {
    // The box ticked itself; put it back to what the server was last told.
    (event.target as HTMLInputElement).checked = ticked.value.has(collection.id);
    return;
  }
  const adding = !ticked.value.has(collection.id);
  const flip = (on: boolean) => {
    const next = new Set(ticked.value);
    on ? next.add(collection.id) : next.delete(collection.id);
    ticked.value = next;
  };
  flip(adding);
  pending.value = new Set(pending.value).add(collection.id);
  problem.value = null;
  try {
    await $fetch(`/api/collections/${collection.id}/recipes/${recipe.id}`, {
      method: adding ? "PUT" : "DELETE",
      retry: 0,
    });
    changed = true;
    list.forget(collection.id);
    collections.value = (await list.reload()).collections;
  } catch (error) {
    if (target.value === recipe) {
      flip(!adding);
      problem.value = messageFor((error as { statusCode?: number }).statusCode, adding);
    }
  } finally {
    const next = new Set(pending.value);
    next.delete(collection.id);
    pending.value = next;
  }
}

async function create() {
  const recipe = target.value;
  const name = newName.value.trim();
  if (!recipe || !name || creating.value) return;
  creating.value = true;
  problem.value = null;
  try {
    const { collection } = await $fetch<{ collection: { id: string } }>("/api/collections", {
      method: "POST",
      body: { name },
      retry: 0,
    });
    await $fetch(`/api/collections/${collection.id}/recipes/${recipe.id}`, { method: "PUT", retry: 0 });
    changed = true;
    if (target.value !== recipe) return;
    ticked.value = new Set(ticked.value).add(collection.id);
    newName.value = "";
    collections.value = (await list.reload()).collections;
  } catch (error) {
    if (target.value !== recipe) return;
    const status = (error as { statusCode?: number }).statusCode;
    problem.value =
      status === 409
        ? `You already have a collection called “${name}”.`
        : status === 413
          ? "That name is too long. Keep it under 80 characters."
          : status === 401
            ? "Your session ended. Sign in again to make a collection."
            : "The collection couldn’t be made. Try again.";
  } finally {
    creating.value = false;
  }
}

const countOf = (collection: CollectionSummary) =>
  `${collection.count} recipe${collection.count === 1 ? "" : "s"}`;
</script>

<template>
  <BaseDialog
    :open="!!target"
    title-id="picker-title"
    close-label="Close"
    modal-class="picker-modal"
    @close="close"
  >
    <div v-if="target" class="picker-content">
      <div class="eyebrow picker-eyebrow">{{ target.title }}</div>
      <h2 id="picker-title">Add to a <em>collection.</em></h2>

      <p v-if="!target.pinned" class="earlier-version picker-earlier" role="note">
        <span>
          <strong>This is an earlier version.</strong> A collection keeps the
          version you add, so it will show this one, not the newest.
        </span>
      </p>

      <p v-if="loading && !collections.length" class="picker-state" role="status">
        Finding your collections…
      </p>
      <div v-else-if="loadFailed" class="picker-state" role="alert">
        <p>Your collections couldn’t be read.</p>
        <button type="button" class="text-button" @click="load">Try again</button>
      </div>
      <template v-else>
        <p v-if="!collections.length" class="picker-state">
          No collections yet. Make the first one below.
        </p>
        <ul v-else class="picker-list" aria-label="Your collections">
          <li v-for="collection in collections" :key="collection.id">
            <label class="picker-option" :class="{ pending: pending.has(collection.id) }">
              <input
                type="checkbox"
                :checked="ticked.has(collection.id)"
                :aria-busy="pending.has(collection.id)"
                @change="toggle(collection, $event)"
              />
              <span class="picker-name">{{ collection.name }}</span>
              <span class="picker-count">{{ countOf(collection) }}</span>
            </label>
          </li>
        </ul>

        <form class="picker-new" @submit.prevent="create">
          <label class="field-label" for="picker-new-name">New collection</label>
          <div class="picker-new-row">
            <input
              id="picker-new-name"
              v-model="newName"
              type="text"
              maxlength="80"
              autocomplete="off"
              placeholder="Weeknight, Christmas 2026…"
            />
            <button type="submit" class="button small" :disabled="!newName.trim() || creating">
              {{ creating ? "Making…" : "Make and add" }}
            </button>
          </div>
        </form>
      </template>

      <p v-if="problem" class="edit-bar-problem picker-problem" role="alert">{{ problem }}</p>

      <div class="leave-actions picker-actions">
        <button type="button" class="button small" @click="close">Done</button>
      </div>
    </div>
  </BaseDialog>
</template>
