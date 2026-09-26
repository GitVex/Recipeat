<script setup lang="ts">
import type { ExtractedRecipe } from "#shared/types/recipe";
import type {
  ExtractionRequest,
  ExtractionSource,
} from "~/composables/useExtraction";
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  extracted: [recipe: ExtractedRecipe];
  // A sign-in left this page with an import half done; open the dialog again.
  resume: [];
}>();
const { loggedIn, login } = useOidcAuth();
const { pending, slow, failure, extract, cancel } = useExtraction();
const mode = ref<ExtractionSource>("website");
const input = ref("");
const file = ref<File | null>(null);
const error = ref("");

// Signing in leaves the page, so what was typed goes to sessionStorage first
// and comes back when the provider sends the user home. A photo cannot make
// that trip: a File does not survive the page.
const DRAFT_KEY = "recipeat-import-draft";

function signIn() {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ mode: mode.value, input: input.value }),
    );
  } catch {}
  login("zitadel");
}

onMounted(() => {
  let draft: { mode?: unknown; input?: unknown } | null = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
  if (!draft) return;
  if (
    draft.mode === "website" ||
    draft.mode === "text" ||
    draft.mode === "photo"
  )
    mode.value = draft.mode;
  if (typeof draft.input === "string") input.value = draft.input;
  emit("resume");
});

watch(
  () => props.open,
  (open) => {
    if (open) error.value = "";
    else cancel();
  },
);

function switchTo(tab: ExtractionSource) {
  cancel();
  mode.value = tab;
  input.value = "";
  error.value = "";
  failure.value = null;
}

function chooseFile(event: Event) {
  const chosen = (event.target as HTMLInputElement).files?.[0];
  if (!chosen) return;
  if (!chosen.type.startsWith("image/")) {
    error.value = "Please choose an image file.";
    return;
  }
  file.value = chosen;
  error.value = "";
}

// What the dialog can check without asking the server. Returns the request to
// send, or null with `error` saying what to fix.
function request(): ExtractionRequest | null {
  if (mode.value === "website") {
    try {
      const url = new URL(input.value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      error.value =
        "Enter a full recipe URL, such as https://example.com/recipe.";
      return null;
    }
    return { source: "website", url: input.value };
  }
  if (mode.value === "text") {
    if (!input.value.trim()) {
      error.value = "Paste the recipe text first.";
      return null;
    }
    return { source: "text", text: input.value };
  }
  if (!file.value) {
    error.value = "Choose a photo of the recipe first.";
    return null;
  }
  return { source: "photo", file: file.value };
}

async function submit() {
  if (pending.value || !loggedIn.value) return;
  error.value = "";
  const next = request();
  if (!next) return;
  const recipe = await extract(next);
  if (recipe) emit("extracted", recipe);
}

const TABS = [
  { id: "website", name: "Website", icon: "link" },
  { id: "photo", name: "Photo", icon: "camera" },
  { id: "text", name: "Text", icon: "text" },
] as const;

const WAIT: Record<ExtractionSource, string> = {
  website: "Reading the page. This usually takes a few seconds.",
  text: "Reading your recipe. This usually takes several seconds.",
  photo: "Reading your photo. This usually takes several seconds.",
};
</script>

<template>
  <BaseDialog
    :open="open"
    title-id="import-title"
    close-label="Close import"
    modal-class="import-modal"
    @close="emit('close')"
  >
    <div class="eyebrow">A NEW FAVORITE STARTS HERE</div>
    <h2 id="import-title">Bring your <em>inspiration.</em></h2>
    <template v-if="loggedIn">
      <p>
        Paste a link, share a photo, or drop in your own notes, and we’ll turn
        it into a recipe you can cook from.
      </p>
      <div class="import-tabs" role="tablist">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          role="tab"
          :aria-selected="mode === tab.id"
          :class="{ active: mode === tab.id }"
          @click="switchTo(tab.id)"
        >
          <AppIcon :name="tab.icon" :size="17" />{{ tab.name }}
        </button>
      </div>
      <form @submit.prevent="submit">
        <label v-if="mode === 'website'" class="field-label"
          >Recipe URL<input
            v-model="input"
            type="url"
            placeholder="https://your-favorite-food-blog.com/recipe"
            required /></label
        ><label v-else-if="mode === 'text'" class="field-label"
          >Recipe text<textarea
            v-model="input"
            rows="5"
            placeholder="Paste ingredients and instructions here…"
            required
          /></label
        ><label v-else class="file-upload"
          ><AppIcon name="camera" :size="32" /><strong>{{
            file?.name || "Choose a photo or screenshot"
          }}</strong
          ><span>JPG, PNG, or another image format</span
          ><input type="file" accept="image/*" @change="chooseFile"
        /></label>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <div
          v-else-if="failure"
          role="alert"
          :class="['import-failure', { error: failure.fault }]"
        >
          <p>{{ failure.message }}</p>
          <button
            v-if="failure.action === 'retry'"
            type="submit"
            class="text-button"
          >
            Try again
          </button>
          <button
            v-else-if="failure.action === 'signIn'"
            type="button"
            class="text-button"
            @click="signIn"
          >
            Sign in again
          </button>
        </div>
        <button class="button full-width" :disabled="!!pending">
          {{ pending ? "Reading…" : "Bring it in"
          }}<AppIcon name="sparkle" :size="17" />
        </button>
        <p v-if="pending" role="status" class="import-wait">
          {{ WAIT[pending] }}
          <template v-if="slow">
            Still working: the first import in a while takes longer.</template
          >
        </p>
      </form>
    </template>
    <template v-else>
      <p>
        Every recipe you bring in goes into your own collection, so we need to
        know whose it is. Sign in, and you can bring recipes in from websites,
        photos and your own notes.
      </p>
      <button class="button full-width" @click="signIn">
        Sign in to continue<AppIcon name="arrow" :size="17" />
      </button>
    </template>
  </BaseDialog>
</template>
