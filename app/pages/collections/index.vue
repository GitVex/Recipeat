<script setup lang="ts">
import type { CollectionSummary } from "#shared/types/collection";

// The collections (#71): a quiet page, a search bar on top, and a card for
// each collection with the first four recipes in it. Made, renamed and
// deleted from here; filled from a recipe, through the picker (#70), and
// opened and ordered on its own page (#72).
const { login } = useOidcAuth();
const { notify } = useToast();
const { data, error, status, refresh } = useCollectionList();
const list = useCollectionListCache();
const writes = useCollectionWrites();

const collections = computed(() => data.value?.collections ?? []);
const failure = computed(() => (error.value ? failureOf(error.value.statusCode) : null));

// Names only, on the client: a person's collections are a short list, and
// the listing already holds every name. Accents and case are ignored, so
// "ragu" finds "Ragù night".
const query = ref("");
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const shown = computed(() => {
  const wanted = fold(query.value.trim());
  return wanted ? collections.value.filter((c) => fold(c.name).includes(wanted)) : collections.value;
});

// ── Making one ─────────────────────────────────────────────────────────────

const making = ref(false);
const newName = ref("");
const creating = ref(false);
const createProblem = ref<string | null>(null);
const newInput = ref<HTMLInputElement | null>(null);

async function startMaking() {
  making.value = true;
  createProblem.value = null;
  await nextTick();
  newInput.value?.focus();
}
function stopMaking() {
  making.value = false;
  newName.value = "";
  createProblem.value = null;
}
async function create() {
  const name = newName.value.trim();
  if (!name || creating.value) return;
  creating.value = true;
  createProblem.value = null;
  try {
    await $fetch("/api/collections", { method: "POST", body: { name }, retry: 0 });
    await list.reload();
    stopMaking();
    // A search that would hide the new one is cleared, so it can be seen.
    if (!fold(name).includes(fold(query.value.trim()))) query.value = "";
  } catch (error) {
    createProblem.value = collectionNameProblem((error as { statusCode?: number }).statusCode, name);
  } finally {
    creating.value = false;
  }
}

// ── Renaming one, in its card ──────────────────────────────────────────────

const renaming = ref<string | null>(null);
const renameTo = ref("");
const renamePending = ref(false);
const renameProblem = ref<string | null>(null);

async function startRename(collection: CollectionSummary) {
  renaming.value = collection.id;
  renameTo.value = collection.name;
  renameProblem.value = null;
  await nextTick();
  const input = document.getElementById(`rename-${collection.id}`) as HTMLInputElement | null;
  input?.focus();
  input?.select();
}
async function stopRename(collection: CollectionSummary) {
  renaming.value = null;
  renameProblem.value = null;
  await nextTick();
  document.getElementById(`actions-${collection.id}`)?.querySelector<HTMLElement>("button")?.focus();
}
async function rename(collection: CollectionSummary) {
  const name = renameTo.value.trim();
  if (renamePending.value) return;
  if (name === collection.name) return stopRename(collection);
  renamePending.value = true;
  renameProblem.value = null;
  try {
    await writes.rename(collection.id, name);
    await stopRename(collection);
  } catch (error) {
    renameProblem.value = collectionNameProblem((error as { statusCode?: number }).statusCode, name);
  } finally {
    renamePending.value = false;
  }
}

// ── Deleting one ───────────────────────────────────────────────────────────

const deleting = ref<CollectionSummary | null>(null);
const deletePending = ref(false);
const deleteProblem = ref<string | null>(null);
const deleteActions = ref<HTMLElement | null>(null);

const newButton = ref<HTMLButtonElement | null>(null);
watch(deleting, async (value, previous) => {
  deleteProblem.value = null;
  await nextTick();
  // The safe answer is the one that takes focus, and closing hands it back to
  // the card it came from — or, with the card gone, to making another.
  if (value) deleteActions.value?.querySelector<HTMLElement>(".keep")?.focus();
  else if (previous)
    (document.querySelector<HTMLElement>(`#actions-${previous.id} .delete-recipe`) ?? newButton.value)?.focus();
});

async function confirmDelete() {
  const collection = deleting.value;
  if (!collection || deletePending.value) return;
  deletePending.value = true;
  try {
    await writes.remove(collection.id);
  } catch {
    deleteProblem.value = "It couldn’t be deleted. Try again.";
    deletePending.value = false;
    return;
  }
  deletePending.value = false;
  deleting.value = null;
  notify(`“${collection.name}” is gone. Its recipes are still in My recipes`);
}

const recipesIn = (n: number) => `${n} recipe${n === 1 ? "" : "s"}`;

useHead({ title: "Your collections — Recipeat" });
</script>

<template>
  <section class="collections-page page-width">
    <div class="collections-heading">
      <div>
        <div class="eyebrow">GATHERED BY YOU</div>
        <h1>Your <em>collections.</em></h1>
      </div>
      <button
        v-if="!failure && data && !making"
        ref="newButton"
        type="button"
        class="button small"
        @click="startMaking"
      >
        <AppIcon name="plus" :size="15" />New collection
      </button>
    </div>

    <p v-if="status === 'pending' && !data" class="collection-state" role="status">
      Gathering your collections…
    </p>

    <div v-else-if="failure === 'signedOut'" class="collection-state">
      <AppIcon name="bookmark" :size="32" />
      <h2>Your collections are waiting.</h2>
      <p>Sign in to see the collections you’ve made.</p>
      <button class="button" @click="login('zitadel')">
        Sign in <AppIcon name="arrow" />
      </button>
    </div>

    <div v-else-if="failure" class="collection-state" role="alert">
      <h2>We couldn’t open your collections.</h2>
      <p v-if="failure === 'unavailable'">
        Saving isn’t available on this server, so there are no collections to
        show.
      </p>
      <template v-else>
        <p>Something went wrong reading them. Your recipes are still there.</p>
        <button class="button" @click="refresh()">Try again</button>
      </template>
    </div>

    <template v-else>
      <div v-if="collections.length" class="collections-search">
        <AppIcon name="search" :size="15" />
        <input
          v-model="query"
          type="search"
          aria-label="Search your collections"
          placeholder="Search your collections"
          autocomplete="off"
        />
      </div>

      <form v-if="making" class="collections-new" @submit.prevent="create" @keydown.esc="stopMaking">
        <label class="field-label" for="new-collection-name">New collection</label>
        <div class="picker-new-row">
          <input
            id="new-collection-name"
            ref="newInput"
            v-model="newName"
            type="text"
            maxlength="80"
            autocomplete="off"
            placeholder="Weeknight, Christmas 2026…"
          />
          <button type="submit" class="button small" :disabled="!newName.trim() || creating">
            {{ creating ? "Making…" : "Make it" }}
          </button>
          <button type="button" class="text-button" @click="stopMaking">Cancel</button>
        </div>
        <p v-if="createProblem" class="edit-bar-problem" role="alert">{{ createProblem }}</p>
      </form>

      <div v-if="!collections.length && !making" class="collection-state">
        <AppIcon name="bookmark" :size="32" />
        <h2>No collections yet.</h2>
        <p>
          Group recipes the way you cook them: weeknights, a holiday, things to
          try.
        </p>
        <button class="button" @click="startMaking">
          Make your first collection <AppIcon name="arrow" />
        </button>
      </div>

      <p v-else-if="collections.length && !shown.length" class="collections-none" role="status">
        No collection is called anything like “{{ query.trim() }}”.
      </p>

      <ul v-if="shown.length" class="collections-grid">
        <li v-for="collection in shown" :key="collection.id" class="collection-card">
          <!-- The first four in the collection's order. Fewer than four leaves
               quiet tiles, and none leaves one mark, never holes. The picture
               opens it as the name does, for a pointer; the name is the one
               way in for the keyboard. -->
          <NuxtLink
            class="collection-mosaic"
            :class="{ empty: !collection.count }"
            :to="`/collections/${collection.id}`"
            tabindex="-1"
            aria-hidden="true"
          >
            <template v-if="collection.count">
              <span v-for="index in 4" :key="index" class="mosaic-cell">
                <RecipeThumb
                  v-if="collection.thumbnails[index - 1]"
                  :image="collection.thumbnails[index - 1]!.image"
                  :title="collection.thumbnails[index - 1]!.title"
                />
              </span>
            </template>
            <AppIcon v-else name="bookmark" :size="28" />
          </NuxtLink>

          <form
            v-if="renaming === collection.id"
            class="collection-rename"
            @submit.prevent="rename(collection)"
            @keydown.esc.stop="stopRename(collection)"
          >
            <label class="visually-hidden" :for="`rename-${collection.id}`">
              New name for {{ collection.name }}
            </label>
            <input
              :id="`rename-${collection.id}`"
              v-model="renameTo"
              type="text"
              maxlength="80"
              autocomplete="off"
            />
            <div class="collection-card-actions">
              <button type="submit" class="text-button" :disabled="!renameTo.trim() || renamePending">
                {{ renamePending ? "Saving…" : "Save" }}
              </button>
              <button type="button" class="text-button" @click="stopRename(collection)">Cancel</button>
            </div>
            <p v-if="renameProblem" class="edit-bar-problem" role="alert">{{ renameProblem }}</p>
          </form>
          <template v-else>
            <h2 class="collection-card-name">
              <NuxtLink :to="`/collections/${collection.id}`">{{ collection.name }}</NuxtLink>
            </h2>
            <div class="collection-card-footer">
              <span class="collection-card-count">{{ recipesIn(collection.count) }}</span>
              <div :id="`actions-${collection.id}`" class="collection-card-actions">
                <button
                  type="button"
                  class="text-button"
                  :aria-label="`Rename ${collection.name}`"
                  @click="startRename(collection)"
                >
                  Rename
                </button>
                <button
                  type="button"
                  class="text-button delete-recipe"
                  :aria-label="`Delete ${collection.name}`"
                  @click="deleting = collection"
                >
                  Delete
                </button>
              </div>
            </div>
          </template>
        </li>
      </ul>
    </template>

    <BaseDialog
      :open="!!deleting"
      title-id="delete-collection-title"
      close-label="Close"
      modal-class="leave-modal"
      @close="deleting = null"
    >
      <div class="leave-content">
        <h2 id="delete-collection-title">Delete “{{ deleting?.name }}”?</h2>
        <p>
          <template v-if="deleting?.count">
            The {{ recipesIn(deleting.count) }} in it stay in My recipes. Only
            the collection goes.
          </template>
          <template v-else>It’s empty, so only its name goes.</template>
        </p>
        <p v-if="deleteProblem" class="edit-bar-problem" role="alert">{{ deleteProblem }}</p>
        <div ref="deleteActions" class="leave-actions">
          <button
            type="button"
            class="button small destructive"
            :disabled="deletePending"
            @click="confirmDelete"
          >
            {{ deletePending ? "Deleting…" : "Delete collection" }}
          </button>
          <button type="button" class="text-button keep" @click="deleting = null">
            Keep it
          </button>
        </div>
      </div>
    </BaseDialog>
  </section>
</template>
