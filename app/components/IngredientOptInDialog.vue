<script setup lang="ts">
// Opting in to the ingredient store (#180): how many of the cook's lines
// would get a question, and whether their saved recipes go through all at
// once or a batch at a time. An invitation, not a warning: the count is
// what they can help with. The answer is `ingredientBackfill`, null for all
// at once.
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ confirm: [backfill: "batched" | null]; cancel: [] }>();

type Preview = { questions: number; batch: { size: number; hours: number } };
const { data, status, execute, clear } = useFetch<Preview>("/api/ingredients/preview", {
  retry: 0,
  server: false,
  immediate: false,
});
const pace = ref<"all" | "batched">("all");
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    pace.value = "all";
    clear();
    execute();
  },
);

const questions = computed(() => data.value?.questions ?? null);
const per = computed(() => {
  const hours = data.value?.batch.hours ?? 24;
  if (hours === 24) return "a day";
  if (hours % 24 === 0) return `every ${hours / 24} days`;
  return hours === 1 ? "an hour" : `every ${hours} hours`;
});
</script>

<template>
  <BaseDialog
    :open="open"
    title-id="opt-in-title"
    close-label="Not now"
    modal-class="leave-modal opt-in-modal"
    @close="emit('cancel')"
  >
    <div class="leave-content">
      <h2 id="opt-in-title">Help name ingredients</h2>
      <p v-if="status === 'pending' || status === 'idle'" class="opt-in-count" role="status">
        Your recipes have
        <span class="opt-in-spinner" aria-label="counting" />
        ingredients you could help name.
      </p>
      <p v-else-if="questions" class="opt-in-count">
        Your recipes have <strong>{{ questions }}</strong>
        ingredient{{ questions === 1 ? "" : "s" }} you could help name. You’ll find
        each question on its recipe’s page, newest recipes first.
      </p>
      <p v-else>
        Questions will show up on your recipes as you save them. Every answer helps
        everyone’s recipes.
      </p>
      <fieldset v-if="questions" class="opt-in-pace">
        <legend class="visually-hidden">How to go through them</legend>
        <label class="preference-option">
          <input v-model="pace" type="radio" name="opt-in-pace" value="all" />
          All of them now
        </label>
        <label class="preference-option">
          <input v-model="pace" type="radio" name="opt-in-pace" value="batched" />
          {{ data!.batch.size }} recipe{{ data!.batch.size === 1 ? "" : "s" }} {{ per }}
        </label>
      </fieldset>
      <div class="leave-actions">
        <button
          type="button"
          class="button small"
          @click="emit('confirm', questions && pace === 'batched' ? 'batched' : null)"
        >
          Start contributing
        </button>
        <button type="button" class="text-button" @click="emit('cancel')">Not now</button>
      </div>
    </div>
  </BaseDialog>
</template>
