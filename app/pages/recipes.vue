<script setup lang="ts">
// The collection: a list of every recipe on one side, and on the other either
// a preview of the one under the pointer or focus (/recipes) or the one that
// was opened (/recipes/[id]). Opening one folds the list into a rail at the
// left, so the recipe gets the room; the rail's toggle opens the list again.
const route = useRoute();
const { openImport } = useDialogs();
const { login } = useOidcAuth();
const { data, error, status, refresh } = useRecipeList();

const recipes = computed(() => data.value?.recipes ?? []);
const failure = computed(() =>
  error.value ? failureOf(error.value.statusCode) : null,
);
const openId = computed(() =>
  typeof route.params.id === "string" ? route.params.id : null,
);

const { id: highlighted, current } = useHighlightedRecipe();

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

useHead({ title: "Your collection — Recipeat" });
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
            Your little <em>collection.</em>
          </h1>
        </div>
        <NuxtLink
          v-if="openId"
          class="rail-toggle icon-button"
          to="/recipes"
          aria-label="Show all your recipes"
          title="Show all your recipes"
        >
          <AppIcon name="menu" />
        </NuxtLink>
      </div>

      <p v-if="status === 'pending' && !data" class="collection-state" role="status">
        Gathering your recipes…
      </p>

      <div v-else-if="failure === 'signedOut'" class="collection-state">
        <AppIcon name="book" :size="35" />
        <h2>Your collection is waiting.</h2>
        <p>Sign in to see the recipes you’ve kept.</p>
        <button class="button" @click="login('zitadel')">
          Sign in <AppIcon name="arrow" />
        </button>
      </div>

      <div v-else-if="failure" class="collection-state" role="alert">
        <h2>We couldn’t open your collection.</h2>
        <p v-if="failure === 'unavailable'">
          Saving isn’t available on this server, so there’s no collection to
          show.
        </p>
        <template v-else>
          <p>Something went wrong reading it. Your recipes are still there.</p>
          <button class="button" @click="refresh()">Try again</button>
        </template>
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
            :to="`/recipes/${recipe.id}`"
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
            </span>
          </NuxtLink>
        </li>
      </ul>
    </aside>

    <div class="collection-pane">
      <NuxtPage :transition="paneTransition" />
    </div>
  </section>
</template>
