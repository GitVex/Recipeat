<script setup lang="ts">
import type { SavedRecipe } from "#shared/types/recipe";

// The collection's preview: the entry under the pointer or focus, as it will
// read once opened. The card fields are on screen at once; the rest is one read
// per recipe the pointer stops on, kept for when it is opened.
// The entries the page beside this is showing, so a filtered list previews
// one of its own.
const { current } = useHighlightedRecipe(inject(SHOWN_RECIPES, ref([])));
const route = useRoute();
const cache = useRecipeCache();
const full = computed(() => (current.value ? cache.value[current.value.id] : undefined));

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => current.value?.id,
  (id) => {
    clearTimeout(timer);
    if (import.meta.server || !id || cache.value[id]) return;
    // A pointer crossing the list highlights everything on its way; only
    // where it comes to rest is worth a read.
    timer = setTimeout(async () => {
      try {
        const { recipe } = await $fetch<{ recipe: SavedRecipe }>(`/api/recipes/${id}`, { retry: 0 });
        cache.value = { ...cache.value, [id]: recipe };
      } catch {
        // The preview is a courtesy. Opening the recipe says what went wrong.
      }
    }, 150);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <!-- One recipe fades into the next as the pointer moves: the one going
       lies over the one coming, so neither waits for the other. -->
  <div class="collection-previews">
    <Transition name="preview" @before-leave="retire">
      <section
        v-if="current"
        :key="current.id"
        class="collection-preview"
        aria-label="Preview"
      >
        <RecipeBody v-if="full" :recipe="full" title-id="preview-title">
          <TagList :tags="full.tags" />
          <NuxtLink class="button small" :to="{ path: `/recipes/${current.id}`, query: route.query }">
            Open recipe <AppIcon name="arrow" :size="16" />
          </NuxtLink>
        </RecipeBody>
        <!-- Until the rest arrives: laid out as the recipe will be, so nothing
             moves when it does. -->
        <template v-else>
          <img v-if="current.image" class="detail-image" :src="current.image" alt="" />
          <div class="detail-content">
            <div class="eyebrow">{{ formatMinutes(current.totalTime)?.toUpperCase() ?? " " }}</div>
            <h2 id="preview-title" class="detail-title" :class="{ untitled: !current.title }">
              {{ recipeTitle(current) }}
            </h2>
            <TagList :tags="current.tags" />
            <NuxtLink class="button small" :to="{ path: `/recipes/${current.id}`, query: route.query }">
              Open recipe <AppIcon name="arrow" :size="16" />
            </NuxtLink>
          </div>
        </template>
      </section>
    </Transition>
  </div>
</template>
