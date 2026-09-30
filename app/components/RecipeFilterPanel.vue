<script setup lang="ts">
import { filterCount, SOURCE_TYPES, type RecipeFilters } from "#shared/utils/recipeFilters";
import { sameTag, tidyTagName } from "#shared/utils/tags";

// The collection's filters (#14), opened from the button beside the search:
// the tags in use, an ingredient, how long, how many it serves, and where it
// came from. Every choice narrows what the others left, and each one is sent
// up as it is made — the page puts it in the address, which is what reads the
// list again.
const props = defineProps<{ filters: RecipeFilters; id: string }>();
const emit = defineEmits<{ change: [filters: RecipeFilters] }>();

const { data: tagListing } = useTagList();
const set = (patch: Partial<RecipeFilters>) => emit("change", { ...props.filters, ...patch });

// The tags in use, and any the address asks for that no recipe wears any
// more: shown, so it can be taken off again.
const tagChoices = computed(() => {
  const names = (tagListing.value?.tags ?? []).map((tag) => tag.name);
  const asked = props.filters.tags.filter((tag) => !names.some((name) => sameTag(name, tag)));
  return [...names, ...asked];
});
const tagOn = (name: string) => props.filters.tags.some((tag) => sameTag(tag, name));
const toggleTag = (name: string) =>
  set({
    tags: tagOn(name)
      ? props.filters.tags.filter((tag) => !sameTag(tag, name))
      : [...props.filters.tags, name],
  });

const ingredient = ref("");
function addIngredient() {
  const term = tidyTagName(ingredient.value);
  ingredient.value = "";
  if (!term || props.filters.ingredients.some((each) => sameTag(each, term))) return;
  set({ ingredients: [...props.filters.ingredients, term] });
}
const removeIngredient = (term: string) =>
  set({ ingredients: props.filters.ingredients.filter((each) => each !== term) });

// Choices rather than a number to type. One the address asked for that is
// not among them is added, so it can be seen and changed.
const TIMES = [15, 30, 60, 120];
const times = computed(() => {
  const asked = props.filters.maxTime;
  return asked === null || TIMES.includes(asked) ? TIMES : [...TIMES, asked].sort((a, b) => a - b);
});
const timeLabel = (minutes: number) => `${formatMinutes(minutes)} or less`;

type Serves = { label: string; min: number | null; max: number | null };
const SERVES: Serves[] = [
  { label: "1–2", min: null, max: 2 },
  { label: "3–4", min: 3, max: 4 },
  { label: "5 or more", min: 5, max: null },
];
const serves = computed(() => {
  const { minPortions: min, maxPortions: max } = props.filters;
  if (min === null && max === null) return SERVES;
  if (SERVES.some((each) => each.min === min && each.max === max)) return SERVES;
  const label = min !== null && max !== null ? `${min}–${max}` : min !== null ? `${min} or more` : `Up to ${max}`;
  return [...SERVES, { label, min, max }];
});
const servesOn = (each: Serves) =>
  props.filters.minPortions === each.min && props.filters.maxPortions === each.max;

const SOURCES: Record<RecipeFilters["sources"][number], string> = {
  website: "A website",
  instagram: "Instagram",
  photo: "A photo",
  text: "Your notes",
};
const sourceOn = (type: RecipeFilters["sources"][number]) => props.filters.sources.includes(type);
const toggleSource = (type: RecipeFilters["sources"][number]) =>
  set({
    sources: sourceOn(type)
      ? props.filters.sources.filter((each) => each !== type)
      : [...props.filters.sources, type],
  });

const clear = () =>
  set({ tags: [], ingredients: [], maxTime: null, minPortions: null, maxPortions: null, sources: [] });
</script>

<template>
  <section :id="id" class="filter-panel" aria-label="Filters">
    <div class="filter-group" role="group" aria-labelledby="filter-tags">
      <h2 id="filter-tags" class="filter-heading">Tags</h2>
      <div v-if="tagChoices.length" class="filter-options">
        <button
          v-for="name in tagChoices"
          :key="name"
          type="button"
          class="filter-option"
          :aria-pressed="tagOn(name)"
          @click="toggleTag(name)"
        >
          {{ name }}
        </button>
      </div>
      <p v-else class="filter-empty">
        None yet. Tag a recipe on its own page and the tags show up here.
      </p>
    </div>

    <div class="filter-group">
      <h2 class="filter-heading"><label for="filter-ingredient">Has an ingredient</label></h2>
      <div class="filter-options">
        <span v-for="term in filters.ingredients" :key="term" class="tag">
          {{ term }}
          <button
            type="button"
            class="tag-remove"
            :aria-label="`Stop filtering by ${term}`"
            @click="removeIngredient(term)"
          >
            <AppIcon name="close" :size="11" />
          </button>
        </span>
        <input
          id="filter-ingredient"
          v-model="ingredient"
          class="filter-input"
          type="text"
          placeholder="Like “leeks”, then Enter"
          autocomplete="off"
          enterkeyhint="search"
          maxlength="100"
          @keydown.enter.prevent="addIngredient"
        />
      </div>
    </div>

    <div class="filter-group" role="group" aria-labelledby="filter-time">
      <h2 id="filter-time" class="filter-heading">Ready in</h2>
      <div class="filter-options">
        <button
          type="button"
          class="filter-option"
          :aria-pressed="filters.maxTime === null"
          @click="set({ maxTime: null })"
        >
          Any time
        </button>
        <button
          v-for="minutes in times"
          :key="minutes"
          type="button"
          class="filter-option"
          :aria-pressed="filters.maxTime === minutes"
          @click="set({ maxTime: minutes })"
        >
          {{ timeLabel(minutes) }}
        </button>
      </div>
    </div>

    <div class="filter-group" role="group" aria-labelledby="filter-serves">
      <h2 id="filter-serves" class="filter-heading">Serves</h2>
      <div class="filter-options">
        <button
          type="button"
          class="filter-option"
          :aria-pressed="filters.minPortions === null && filters.maxPortions === null"
          @click="set({ minPortions: null, maxPortions: null })"
        >
          Any
        </button>
        <button
          v-for="each in serves"
          :key="each.label"
          type="button"
          class="filter-option"
          :aria-pressed="servesOn(each)"
          @click="set({ minPortions: each.min, maxPortions: each.max })"
        >
          {{ each.label }}
        </button>
      </div>
    </div>

    <div class="filter-group" role="group" aria-labelledby="filter-source">
      <h2 id="filter-source" class="filter-heading">Came from</h2>
      <div class="filter-options">
        <button
          v-for="type in SOURCE_TYPES"
          :key="type"
          type="button"
          class="filter-option"
          :aria-pressed="sourceOn(type)"
          @click="toggleSource(type)"
        >
          <AppIcon :name="SOURCE_ICON[type]" :size="13" />{{ SOURCES[type] }}
        </button>
      </div>
    </div>

    <button
      v-if="filterCount(filters)"
      type="button"
      class="text-button filter-clear"
      @click="clear"
    >
      Clear filters
    </button>
  </section>
</template>
