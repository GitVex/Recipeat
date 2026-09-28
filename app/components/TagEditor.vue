<script setup lang="ts">
import type { SavedRecipe } from "#shared/types/recipe";
import { MAX_TAGS, sameTag, tagNameProblem, tidyTagName } from "#shared/utils/tags";

// A stored recipe's tags, on its own page (#13): each one a chip that can be
// taken off, and a field to put another on, suggesting the tags already in
// use. A change is saved as soon as it is made, and apart from the recipe's
// own Save: tags belong to the line, not to the version being edited.
const props = defineProps<{ recipe: SavedRecipe }>();
const emit = defineEmits<{ change: [tags: string[]] }>();

const { data: listing } = useTagList();
const writes = useTagWrites();

const tags = ref<string[]>([...props.recipe.tags]);
watch(
  () => props.recipe.tags,
  (value) => (tags.value = [...value]),
);

const draft = ref("");
const saving = ref(false);
const problem = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);

// What is in use and not already here, for the field's suggestions.
const suggestions = computed(() =>
  (listing.value?.tags ?? [])
    .map((tag) => tag.name)
    .filter((name) => !tags.value.some((tag) => sameTag(tag, name))),
);

async function save(next: string[]) {
  const before = tags.value;
  tags.value = next;
  saving.value = true;
  problem.value = null;
  try {
    tags.value = await writes.set(props.recipe, next);
    emit("change", tags.value);
    return true;
  } catch (error) {
    tags.value = before;
    problem.value = tagsProblem((error as { statusCode?: number }).statusCode);
    return false;
  } finally {
    saving.value = false;
  }
}

async function add() {
  const name = tidyTagName(draft.value);
  if (!name) return;
  // One already on it, in any case, is not a second one.
  if (tags.value.some((tag) => sameTag(tag, name))) {
    draft.value = "";
    return;
  }
  problem.value = tagNameProblem(name);
  if (!problem.value && tags.value.length >= MAX_TAGS)
    problem.value = `A recipe has up to ${MAX_TAGS} tags.`;
  if (problem.value) return;
  // A suggestion taken in another case is that tag, as it is written.
  const known = suggestions.value.find((tag) => sameTag(tag, name));
  if (await save([...tags.value, known ?? name])) draft.value = "";
  await nextTick();
  input.value?.focus();
}

async function remove(name: string) {
  await save(tags.value.filter((tag) => tag !== name));
  input.value?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    add();
  }
}
</script>

<template>
  <div class="tag-editor">
    <!-- Spans, as TagList has them: the recipe body styles its own lists. -->
    <span v-if="tags.length" class="tag-list" role="list" aria-label="Tags">
      <span v-for="tag in tags" :key="tag" class="tag" role="listitem">
        {{ tag }}
        <button
          type="button"
          class="tag-remove"
          :aria-label="`Remove the tag ${tag}`"
          :disabled="saving"
          @click="remove(tag)"
        >
          <AppIcon name="close" :size="11" />
        </button>
      </span>
    </span>
    <div class="tag-add">
      <AppIcon name="tag" :size="13" />
      <input
        ref="input"
        v-model="draft"
        type="text"
        aria-label="Add a tag"
        :placeholder="tags.length ? 'Add a tag' : 'Add a tag, like “weeknight”'"
        list="tag-suggestions"
        autocomplete="off"
        enterkeyhint="done"
        :maxlength="60"
        :disabled="saving"
        @keydown="onKeydown"
      />
      <datalist id="tag-suggestions">
        <option v-for="name in suggestions" :key="name" :value="name" />
      </datalist>
    </div>
    <p v-if="problem" class="tag-problem" role="alert">{{ problem }}</p>
  </div>
</template>
