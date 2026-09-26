<script setup lang="ts">
import { recipes, type ShelfRecipe } from "~/data/recipes";
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; extracted: [recipe: ShelfRecipe] }>();
const mode = ref("link");
const input = ref("");
const fileName = ref("");
const error = ref("");
const importing = ref(false);
let importTimer: ReturnType<typeof setTimeout>;
watch(
  () => props.open,
  (open) => {
    if (open) error.value = "";
    else {
      clearTimeout(importTimer);
      importing.value = false;
    }
  },
);
onBeforeUnmount(() => clearTimeout(importTimer));
function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    error.value = "Please choose an image file.";
    return;
  }
  fileName.value = file.name;
  error.value = "";
}
function extract() {
  error.value = "";
  if (mode.value === "link") {
    try {
      const url = new URL(input.value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      error.value =
        "Enter a full recipe URL, such as https://example.com/recipe.";
      return;
    }
  }
  if (mode.value === "photo" && !fileName.value) {
    error.value = "Choose a recipe photo to try the demo.";
    return;
  }
  if (mode.value === "text" && input.value.trim().length < 10) {
    error.value = "Paste a few lines of recipe text to try the demo.";
    return;
  }
  importing.value = true;
  importTimer = setTimeout(() => {
    importing.value = false;
    emit(
      "extracted",
      recipes[mode.value === "photo" ? 1 : mode.value === "text" ? 2 : 0],
    );
  }, 1100);
}
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
    <p>
      Try the experience with a sample recipe. This demo doesn’t upload your
      files or extract real content.
    </p>
    <div class="import-tabs" role="tablist">
      <button
        v-for="tab in [
          { id: 'link', name: 'Website', icon: 'link' },
          { id: 'photo', name: 'Photo', icon: 'camera' },
          { id: 'text', name: 'Text', icon: 'text' },
        ]"
        :key="tab.id"
        role="tab"
        :aria-selected="mode === tab.id"
        :class="{ active: mode === tab.id }"
        @click="
          mode = tab.id;
          input = '';
          error = '';
        "
      >
        <AppIcon :name="tab.icon" :size="17" />{{ tab.name }}
      </button>
    </div>
    <form @submit.prevent="extract">
      <label v-if="mode === 'link'" class="field-label"
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
          fileName || "Choose a photo or screenshot"
        }}</strong
        ><span>JPG, PNG, or another image format</span
        ><input type="file" accept="image/*" @change="chooseFile"
      /></label>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <button class="button full-width" :disabled="importing">
        {{
          importing
            ? "Preparing your sample recipe…"
            : "Preview a sample recipe"
        }}<AppIcon name="sparkle" :size="17" />
      </button>
    </form>
    <small class="demo-note">Interactive preview · No account needed</small>
  </BaseDialog>
</template>
