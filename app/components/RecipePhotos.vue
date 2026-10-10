<script setup lang="ts">
import type { RecipePhotos } from "#shared/types/recipe";
import { imageUrl, MAX_PHOTOS } from "#shared/utils/images";

// Photos of the dish (#45), this version's own: each version is another go at
// it, so a new one starts with none. Up to ten, in an order, one of them the
// cover a card shows. Beside them, the page the line was imported from, when
// it was kept. Every change is answered with the whole set, which replaces
// what is shown.
const props = defineProps<{ recipeId: string }>();

const { data, refresh } = useRecipePhotos(props.recipeId);
const { relist } = useRecipeListCache();
const photos = computed(() => data.value?.photos ?? []);
const full = computed(() => photos.value.length >= MAX_PHOTOS);
const busy = ref(false);
const problem = ref<string | null>(null);

// One change at a time, and the card in the listing follows it.
async function change(request: () => Promise<RecipePhotos | null>) {
  if (busy.value) return;
  busy.value = true;
  problem.value = null;
  try {
    const next = await request();
    if (next) data.value = next;
    else await refresh();
    void relist();
  } catch (error) {
    problem.value = uploadMessage(error);
    // A 409 means what is shown is out of date.
    if ((error as { statusCode?: number }).statusCode === 409) await refresh();
  } finally {
    busy.value = false;
  }
}

function add(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || full.value) return;
  void change(async () =>
    $fetch<RecipePhotos>(`/api/recipes/${props.recipeId}/photos`, {
      method: "POST",
      body: await imageForm(file),
      retry: 0,
    }),
  );
}

const arrange = (order: string[], cover: string | null) =>
  change(() =>
    $fetch<RecipePhotos>(`/api/recipes/${props.recipeId}/photos`, {
      method: "PUT",
      body: { order, cover },
      retry: 0,
    }),
  );

function move(index: number, by: -1 | 1) {
  const order = photos.value.map((photo) => photo.id);
  [order[index], order[index + by]] = [order[index + by]!, order[index]!];
  void arrange(order, photos.value.find((photo) => photo.cover)?.id ?? null);
}

const makeCover = (id: string) =>
  arrange(photos.value.map((photo) => photo.id), id);

const remove = (id: string) =>
  change(async () => {
    await $fetch(`/api/images/${id}`, { method: "DELETE", retry: 0 });
    return null;
  });
</script>

<template>
  <section class="recipe-photos" aria-labelledby="photos-heading">
    <h2 id="photos-heading" class="history-heading photos-heading">
      <AppIcon name="camera" :size="16" /><span>Photos of this version</span>
      <span class="history-summary">{{ photos.length }} of {{ MAX_PHOTOS }}</span>
    </h2>
    <ul v-if="photos.length" class="photo-strip">
      <li v-for="(photo, index) in photos" :key="photo.id" class="photo-item">
        <a :href="imageUrl(photo.id)" target="_blank" class="photo-open">
          <img :src="imageUrl(photo.id, 'thumb')" :alt="`Photo ${index + 1}`" loading="lazy" />
        </a>
        <span v-if="photo.cover" class="photo-cover">Cover</span>
        <div class="photo-controls">
          <button
            v-if="!photo.cover"
            type="button"
            class="text-button"
            :disabled="busy"
            @click="makeCover(photo.id)"
          >
            Make cover
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="`Move photo ${index + 1} earlier`"
            :disabled="busy || index === 0"
            @click="move(index, -1)"
          >
            <AppIcon name="up" :size="14" />
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="`Move photo ${index + 1} later`"
            :disabled="busy || index === photos.length - 1"
            @click="move(index, 1)"
          >
            <AppIcon name="down" :size="14" />
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="`Remove photo ${index + 1}`"
            :disabled="busy"
            @click="remove(photo.id)"
          >
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
      </li>
    </ul>
    <!-- Refused here, before anything is uploaded; the server refuses an
         eleventh as well. -->
    <p v-if="full" class="history-note">
      Ten photos is the most a version can have. Remove one to add another.
    </p>
    <label v-else class="text-button photo-add" :class="{ disabled: busy }">
      <AppIcon name="plus" :size="15" />{{ busy ? "Working…" : "Add a photo" }}
      <input type="file" accept="image/*" :disabled="busy" @change="add" />
    </label>
    <p v-if="problem" class="edit-bar-problem" role="alert">{{ problem }}</p>
    <figure v-if="data?.source" class="source-photo">
      <a :href="imageUrl(data.source)" target="_blank">
        <img :src="imageUrl(data.source, 'thumb')" alt="The page this recipe was imported from" loading="lazy" />
      </a>
      <figcaption>
        The page it was imported from.
        <button type="button" class="text-button" :disabled="busy" @click="remove(data.source)">
          Remove
        </button>
      </figcaption>
    </figure>
  </section>
</template>
