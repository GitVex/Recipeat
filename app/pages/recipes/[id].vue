<script setup lang="ts">
import type { SavedRecipe } from "#shared/types/recipe";

// A stored recipe at its own address, so it survives a reload and can be
// linked to. The editor (#34) and the line back to its root (#31) belong here.
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
    <RecipeBody v-else-if="recipe" :recipe="recipe" title-id="open-recipe-title" />
    <p v-else-if="status === 'pending'" class="collection-state" role="status">
      Opening your recipe…
    </p>
  </div>
</template>
