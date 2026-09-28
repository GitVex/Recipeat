<script setup lang="ts">
import type { SavedRecipe } from "#shared/types/recipe";
import type { SaveAction } from "~/composables/useRecipeWrites";

// A stored recipe at its own address, so it survives a reload and can be
// linked to. It is read here, scaled, edited, saved one of three ways, and
// deleted, and the rest of its line is reached from here (#31).
const route = useRoute();
const id = String(route.params.id);
const { login } = useOidcAuth();
const cache = useRecipeCache();

// Not awaited: a recipe the preview already read is shown while this one is
// still on its way. On the server the render waits for it either way.
const request = useFetch<{ recipe: SavedRecipe }>(
  `/api/recipes/${id}`,
  {
    key: `recipe:${id}`,
    retry: 0,
    default: () => (cache.value[id] ? { recipe: cache.value[id] } : undefined),
  },
);
const { data, error, status, refresh } = request;
const recipe = computed(() => data.value?.recipe ?? null);
watch(recipe, (value) => {
  if (value) cache.value = { ...cache.value, [value.id]: value };
});

// Someone else's recipe and one that never existed are the same answer from
// the server, and the same page here. A malformed id is too.
const failure = computed(() => {
  const statusCode = error.value?.statusCode;
  if (!error.value) return null;
  if (statusCode === 404 || statusCode === 400) return "notFound";
  return failureOf(statusCode);
});

// The page says "not found" to a person; the response says it to everything
// else, so a stale link is not indexed or cached as a recipe.
const event = useRequestEvent();
onServerPrefetch(async () => {
  await request;
  if (event && failure.value === "notFound") setResponseStatus(event, 404);
});

useHead(() => ({
  title: recipe.value ? `${recipeTitle(recipe.value)} — Recipeat` : "Recipeat",
}));

// ── History ────────────────────────────────────────────────────────────────

const lineage = useRecipeHistory(id);
const { history, tree, pinning, pinError } = lineage;
// Whether this is the version the collection shows. The line knows better
// than the recipe read before it, once it has been read: a pin moved from the
// history, or handed back by a deletion, is not in the recipe.
const pinned = computed(() =>
  lineage.pinnedId.value ? lineage.pinnedId.value === id : (recipe.value?.pinned ?? true),
);

// ── Editing ────────────────────────────────────────────────────────────────

const editor = useRecipeEditor(recipe);
const { edited, problems } = editor;

let leaving = false;

// Saving an edit one of three ways, and deleting. An overwrite is shown in
// place; a new version, a new recipe or a delete goes to another page, which
// is not leaving with unsaved changes: they have just been dealt with.
const choice = ref<SaveAction>("progression");
const writes = useRecipeWrites(
  id,
  editor,
  (stored) => (data.value = { recipe: stored }),
  async (path) => {
    leaving = true;
    await navigateTo(path);
  },
  () => lineage.refresh(),
);
const { saving, saveError, deleting, deletePending, deleteError } = writes;
const picker = useCollectionPicker();
const save = () => writes.save(choice.value);

// Deleting the recipe on the page is deleting "this recipe"; deleting another
// version on the path to it is deleting that version, and says which.
const deleteWhat = computed(() => {
  const target = deleting.value?.id;
  return !target || target === id ? "this recipe" : versionName(tree.value?.label(target));
});

// Leaving with unsaved changes asks first. Inside the app that is a dialog of
// our own; closing or reloading the tab gets the browser's.
const leavingTo = ref<string | null>(null);
function guard(to: { fullPath: string }) {
  if (!edited.value || leaving) return true;
  leavingTo.value = to.fullPath;
  return false;
}
onBeforeRouteLeave(guard);
onBeforeRouteUpdate(guard);

// The question takes focus when it is asked, on its first answer.
const leaveActions = ref<HTMLElement | null>(null);
watch(leavingTo, async (value) => {
  if (!value) return;
  await nextTick();
  leaveActions.value?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
});

async function leave(action: "save" | "discard") {
  const to = leavingTo.value;
  if (!to) return;
  if (action === "save" && !(await save())) {
    leavingTo.value = null;
    return;
  }
  leaving = true;
  leavingTo.value = null;
  await navigateTo(to);
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!edited.value) return;
  event.preventDefault();
  event.returnValue = "";
}
onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnBeforeUnload));
</script>

<template>
  <div class="collection-recipe">
    <div v-if="failure === 'notFound'" class="collection-state" role="alert">
      <h2>We couldn’t find that recipe.</h2>
      <p>It may have been deleted, or the link may be wrong.</p>
      <NuxtLink class="button" to="/recipes">
        Back to your recipes <AppIcon name="arrow" />
      </NuxtLink>
    </div>
    <div v-else-if="failure === 'signedOut'" class="collection-state">
      <h2>Sign in to open this recipe.</h2>
      <button class="button" @click="login('zitadel')">
        Sign in <AppIcon name="arrow" />
      </button>
    </div>
    <div v-else-if="failure" class="collection-state" role="alert">
      <h2>We couldn’t open this recipe.</h2>
      <p v-if="failure === 'unavailable'">
        Saving isn’t available on this server, so there are no recipes to open.
      </p>
      <button v-else class="button" @click="refresh()">Try again</button>
    </div>
    <template v-else-if="recipe">
      <RecipeBody
        :recipe="recipe"
        :editor="editor"
        scalable
        title-id="open-recipe-title"
      >
        <!-- Reached by going back down the line. Saying so here, before
             anything is changed, is what keeps an edit to it from looking like
             an edit to the recipe the collection shows. -->
        <div v-if="!pinned" class="earlier-version" role="note">
          <p>
            <strong>An earlier version.</strong> My recipes shows another
            version of this recipe. Changes saved here stay with this one.
          </p>
          <button
            type="button"
            class="button small"
            :disabled="!!pinning"
            @click="lineage.pin(id)"
          >
            <AppIcon name="bookmark" :size="15" />{{ pinning === id ? "Pinning…" : "Pin this version" }}
          </button>
        </div>
      </RecipeBody>
      <Transition name="bar" mode="out-in">
        <SaveControl
          v-if="edited"
          v-model="choice"
          :problems="problems"
          :saving="saving"
          :error="saveError"
          :can-save="!!editor.body.value"
          @save="writes.save"
          @discard="editor.reset()"
        />
        <div v-else class="recipe-actions">
          <!-- This version, whichever it is: the picker says so when it is not
               the one the line is entered by. -->
          <button
            type="button"
            class="text-button add-to-collection"
            @click="picker.open({ id, title: recipeTitle(recipe), pinned })"
          >
            <AppIcon name="bookmark" :size="15" />Add to collection
          </button>
          <button
            type="button"
            class="text-button delete-recipe"
            :disabled="deletePending"
            @click="writes.askDelete()"
          >
            <AppIcon name="trash" :size="15" />{{ deletePending && !deleting ? "Checking…" : "Delete recipe" }}
          </button>
        </div>
      </Transition>
      <RecipeHistory
        v-if="history && tree && hasHistory(history)"
        :history="history"
        :tree="tree"
        :current="id"
        :pinning="pinning"
        :pin-error="pinError"
        :deleting="deletePending"
        @pin="lineage.pin"
        @delete="writes.askDelete"
      />
    </template>
    <p v-else-if="status === 'pending'" class="collection-state" role="status">
      Opening your recipe…
    </p>

    <BaseDialog
      :open="!!leavingTo"
      title-id="leave-title"
      close-label="Close"
      modal-class="leave-modal"
      @close="leavingTo = null"
    >
      <div class="leave-content">
        <h2 id="leave-title">Leave without saving?</h2>
        <p>Your changes to this recipe haven’t been saved yet.</p>
        <div ref="leaveActions" class="leave-actions">
          <button
            type="button"
            class="button small"
            :disabled="saving || !editor.body.value"
            @click="leave('save')"
          >
            {{ saving ? "Saving…" : "Save and leave" }}
          </button>
          <button type="button" class="text-button" @click="leave('discard')">
            Discard changes
          </button>
          <button type="button" class="text-button" @click="leavingTo = null">
            Keep editing
          </button>
        </div>
      </div>
    </BaseDialog>

    <DeleteVersionDialog
      :deleting="deleting"
      :what="deleteWhat"
      :pending="deletePending"
      :error="deleteError"
      @confirm="writes.confirmDelete()"
      @cancel="writes.cancelDelete()"
    />
  </div>
</template>
