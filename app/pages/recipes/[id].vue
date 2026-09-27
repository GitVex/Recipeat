<script setup lang="ts">
import type { SavedRecipe } from "#shared/types/recipe";

// A stored recipe at its own address, so it survives a reload and can be
// linked to. It is also where it is edited: any field can be tapped and typed
// into, and Save writes the edit over the recipe. The line back to its root
// (#31) and the other two ways to save (#30) belong here too.
const route = useRoute();
const id = String(route.params.id);
const { login } = useOidcAuth();
const cache = useRecipeCache();
const list = useRecipeListCache();
const { notify } = useToast();

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

// ── Editing ────────────────────────────────────────────────────────────────

const editor = useRecipeEditor(recipe);
const { edited, problems } = editor;


const saving = ref(false);
const saveError = ref<string | null>(null);
watch(edited, (value) => {
  if (!value) saveError.value = null;
});

function saveMessage(error: unknown): string {
  const { statusCode, data } = error as { statusCode?: number; data?: { message?: string } };
  switch (statusCode) {
    case undefined:
      return "We couldn’t reach Recipeat. Check your connection and try again.";
    case 401:
      return "You’ve been signed out. Sign in again in another tab, then save; your changes stay here until you leave this page.";
    case 404:
      return "This recipe isn’t in your collection any more, so there is nothing to save over.";
    case 503:
      return "Saving isn’t available on this server.";
    // The content itself was refused. The editor stops most of this before
    // it is sent; the server's own words say what is left.
    case 400:
    case 413:
    case 422:
      return data?.message ?? "Recipeat couldn’t save this recipe as it is.";
    default:
      return "Something went wrong while saving. Your changes are still here.";
  }
}

/** True once the edit is written. */
async function save(): Promise<boolean> {
  const body = editor.body.value;
  if (!body || saving.value) return false;
  saving.value = true;
  saveError.value = null;
  try {
    const { recipe: stored } = await $fetch<{ recipe: SavedRecipe }>(`/api/recipes/${id}`, {
      method: "PUT",
      body: { recipe: body },
      retry: 0,
    });
    // The recipe is rendered from what came back, re-linked amounts and all,
    // and the edit starts over from it.
    data.value = { recipe: stored };
    list.update(stored);
    notify("Saved");
    return true;
  } catch (error) {
    saveError.value = saveMessage(error);
    return false;
  } finally {
    saving.value = false;
  }
}

// Leaving with unsaved changes asks first. Inside the app that is a dialog of
// our own; closing or reloading the tab gets the browser's.
const leavingTo = ref<string | null>(null);
let leaving = false;
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
        Back to your collection <AppIcon name="arrow" />
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
      />
      <div v-if="edited" class="edit-bar" role="region" aria-label="Unsaved changes">
        <div class="edit-bar-text">
          <p class="edit-bar-title"><span class="unsaved-dot" aria-hidden="true" />Unsaved changes</p>
          <p v-for="problem in problems" :key="problem" class="edit-bar-problem">
            {{ EDIT_PROBLEM[problem] }}
          </p>
          <p v-if="saveError" class="edit-bar-problem" role="alert">{{ saveError }}</p>
        </div>
        <div class="edit-bar-actions">
          <button type="button" class="text-button" :disabled="saving" @click="editor.reset()">
            Discard
          </button>
          <button
            type="button"
            class="button small"
            :disabled="saving || !editor.body.value"
            @click="save"
          >
            {{ saving ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
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
  </div>
</template>
