<script setup lang="ts">
import type { RecipeSummary } from "#shared/types/recipe";
import {
  filterCount,
  filtersToQuery,
  hasFilters,
  NO_FILTERS,
  readFilters,
  type RecipeFilters,
} from "#shared/utils/recipeFilters";

// The collection: a list of every recipe on one side, and on the other either
// a preview of the one under the pointer or focus (/recipes) or the one that
// was opened (/recipes/[id]). Opening one folds the list into a rail at the
// left, so the recipe gets the room; the rail's toggle opens the list again.
const route = useRoute();
const router = useRouter();
const { openImport } = useDialogs();
const { login } = useOidcAuth();
const picker = useCollectionPicker();

// What the list is narrowed by (#14) lives in the address, so a filtered
// list can be linked to and reloaded, and survives opening a recipe from it.
// What the address says that cannot be read is ignored. Compared as the
// query they make, so opening a recipe — a new route, the same filters —
// does not read the list again.
const filterQuery = computed(() => JSON.stringify(filtersToQuery(readFilters(route.query).filters)));
const filters = computed(() => readFilters(JSON.parse(filterQuery.value)).filters);
const filtering = computed(() => hasFilters(filters.value));
const { data, error, status, refresh } = useFilteredRecipeList(filters);

// The list read last stays on screen while the next is read, so a filter
// narrows the list rather than blanking it first.
const last = ref<RecipeSummary[] | null>(null);
watch(data, (value) => value && (last.value = value.recipes), { immediate: true });
const recipes = computed(() => data.value?.recipes ?? last.value ?? []);
provide(SHOWN_RECIPES, recipes);

const failure = computed(() =>
  error.value ? failureOf(error.value.statusCode) : null,
);
const openId = computed(() =>
  typeof route.params.id === "string" ? route.params.id : null,
);

const { id: highlighted, current } = useHighlightedRecipe(recipes);

// Replaced rather than pushed: going back leaves the list, not one filter.
const applyFilters = (next: RecipeFilters) =>
  router.replace({ path: route.path, query: filtersToQuery(next) });
// Where a link inside the list goes, with the filters kept.
const within = (path: string) => ({ path, query: route.query });

// The search goes into the address a moment after typing stops, and follows
// it when the address changes some other way.
const search = ref(filters.value.q);
const tidy = (value: string) => value.trim().replace(/\s+/g, " ");
watch(
  () => filters.value.q,
  (q) => tidy(search.value) !== q && (search.value = q),
);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, (value) => {
  clearTimeout(searchTimer);
  if (tidy(value) === filters.value.q) return;
  searchTimer = setTimeout(() => applyFilters({ ...filters.value, q: tidy(value) }), 250);
});
onBeforeUnmount(() => clearTimeout(searchTimer));

const filtersOpen = ref(false);
const activeFilters = computed(() => filterCount(filters.value));
// Opening a recipe folds the list; the panel has no room in the rail.
watch(openId, (id) => id && (filtersOpen.value = false));
// Nothing to search until there is something saved, but a filter that found
// nothing still needs the way to change it.
const findable = computed(() => !failure.value && (recipes.value.length > 0 || filtering.value));

// The recipe open is the one highlighted, so going back to the list from it
// previews the same recipe, and the pane shows what it already showed.
watch(openId, (id) => id && (highlighted.value = id), { immediate: true });

// Folding the list into the rail, or opening it back out, keeps what the pane
// shows and only moves the pane: the preview and the recipe it opens read
// alike, so a crossfade between them would only blink. Anything else in the
// pane — one recipe for another — crossfades as every page does. On a phone
// there is no preview beside the list to keep, and the pane fades in.
// Always a transition, and only its CSS switched off: `false` would take the
// <Transition> away from around the page, and Vue would build the page again
// from nothing — losing an unsaved edit on a navigation that was then refused.
const paneTransition = ref({ name: "page", mode: "out-in" as const, css: true });
onBeforeRouteUpdate((to, from) => {
  const folding = typeof to.params.id === "string" !== (typeof from.params.id === "string");
  paneTransition.value = {
    ...paneTransition.value,
    css: !(folding && matchMedia("(min-width: 801px)").matches),
  };
});

const meta = (recipe: (typeof recipes.value)[number]) =>
  [
    formatMinutes(recipe.totalTime),
    recipe.portions ? `Serves ${recipe.portions}` : null,
    `${recipe.ingredientCount} ingredient${recipe.ingredientCount === 1 ? "" : "s"}`,
    `${recipe.stepCount} step${recipe.stepCount === 1 ? "" : "s"}`,
  ].filter(Boolean);

useHead({ title: "My recipes — Recipeat" });
</script>

<template>
  <section
    class="collection page-width"
    :class="{
      folded: openId,
      solo: !openId && !recipes.length,
    }"
  >
    <aside class="collection-list" aria-labelledby="collection-heading">
      <div class="collection-heading">
        <div>
          <div class="eyebrow">SAVED FOR SOMETHING GOOD</div>
          <h1 id="collection-heading">
            Your little <em>recipe book.</em>
          </h1>
        </div>
        <NuxtLink
          v-if="openId"
          class="rail-toggle icon-button"
          :to="within('/recipes')"
          aria-label="Show all your recipes"
          title="Show all your recipes"
        >
          <AppIcon name="menu" />
        </NuxtLink>
      </div>

      <div v-if="findable" class="recipe-find">
        <div class="collections-search recipe-search">
          <AppIcon name="search" :size="15" />
          <input
            v-model="search"
            type="search"
            aria-label="Search your recipes"
            placeholder="Search your recipes"
            autocomplete="off"
            enterkeyhint="search"
          />
        </div>
        <button
          type="button"
          class="filter-toggle icon-button"
          :class="{ active: activeFilters }"
          :aria-expanded="filtersOpen"
          aria-controls="recipe-filters"
          :aria-label="activeFilters ? `Filters, ${activeFilters} on` : 'Filters'"
          title="Filters"
          @click="filtersOpen = !filtersOpen"
        >
          <AppIcon name="filter" :size="17" />
          <span v-if="activeFilters" class="filter-count" aria-hidden="true">{{
            activeFilters
          }}</span>
        </button>
      </div>
      <RecipeFilterPanel
        v-if="findable && filtersOpen"
        id="recipe-filters"
        :filters="filters"
        @change="applyFilters"
      />

      <p v-if="status === 'pending' && !data && !last" class="collection-state" role="status">
        Gathering your recipes…
      </p>

      <div v-else-if="failure === 'signedOut'" class="collection-state">
        <AppIcon name="book" :size="35" />
        <h2>Your recipes are waiting.</h2>
        <p>Sign in to see the recipes you’ve kept.</p>
        <button class="button" @click="login('zitadel')">
          Sign in <AppIcon name="arrow" />
        </button>
      </div>

      <div v-else-if="failure" class="collection-state" role="alert">
        <h2>We couldn’t open your recipes.</h2>
        <p v-if="failure === 'unavailable'">
          Saving isn’t available on this server, so there are no recipes to
          show.
        </p>
        <template v-else>
          <p>Something went wrong reading it. Your recipes are still there.</p>
          <button class="button" @click="refresh()">Try again</button>
        </template>
      </div>

      <!-- Not the same as having nothing: the recipes are there, and the
           filters are what hid them. -->
      <div v-else-if="!recipes.length && filtering" class="collection-state" role="status">
        <AppIcon name="search" :size="35" />
        <h2>Nothing matches.</h2>
        <p v-if="filters.q && !activeFilters">
          None of your recipes is called anything like “{{ filters.q }}”.
        </p>
        <p v-else>No recipe fits all of that at once. Try loosening a filter.</p>
        <button class="button" @click="applyFilters(NO_FILTERS)">
          Clear {{ activeFilters ? "filters" : "the search" }}
        </button>
      </div>

      <div v-else-if="!recipes.length" class="collection-state">
        <AppIcon name="book" :size="35" />
        <h2>Nothing saved yet.</h2>
        <p>
          Bring in a recipe from a website, a photo or your own notes, and it
          will live here.
        </p>
        <button class="button" @click="openImport">
          Save your first recipe <AppIcon name="arrow" />
        </button>
      </div>

      <ul v-else class="collection-entries">
        <li v-for="recipe in recipes" :key="recipe.id">
          <NuxtLink
            class="collection-entry"
            :class="{
              current: openId ? recipe.id === openId : recipe.id === current?.id,
            }"
            :to="within(`/recipes/${recipe.id}`)"
            :aria-current="recipe.id === openId ? 'page' : undefined"
            :title="openId ? recipeTitle(recipe) : undefined"
            @mouseenter="highlighted = recipe.id"
            @focus="highlighted = recipe.id"
          >
            <RecipeThumb :image="recipe.image" :title="recipe.title" />
            <span class="entry-text">
              <span class="entry-title" :class="{ untitled: !recipe.title }">{{
                recipeTitle(recipe)
              }}</span>
              <span class="entry-meta">{{ meta(recipe).join(" · ") }}</span>
              <TagList :tags="recipe.tags" />
            </span>
          </NuxtLink>
          <!-- Beside the link rather than in it: a button inside a link is
               two controls in one, and neither works well by keyboard. The
               list only shows pinned versions. -->
          <button
            type="button"
            class="entry-add icon-button"
            :aria-label="`Add ${recipeTitle(recipe)} to a collection`"
            title="Add to a collection"
            @click="picker.open({ id: recipe.id, title: recipeTitle(recipe), pinned: true })"
          >
            <AppIcon name="bookmark" :size="16" />
          </button>
        </li>
      </ul>
    </aside>

    <div class="collection-pane">
      <NuxtPage :transition="paneTransition" />
    </div>
  </section>
</template>
