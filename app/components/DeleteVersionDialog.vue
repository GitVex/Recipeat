<script setup lang="ts">
// The question before a version goes, wherever it is asked from. It names
// what goes — `what` is "this recipe", "version 3", "the original" — and how
// many later versions go with it, from the dry run. What branched off as a
// separate recipe is not in the count, and nothing here suggests it is.
const props = defineProps<{
  deleting: { id: string; count: number } | null;
  what: string;
  pending: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const title = computed(() => {
  const count = props.deleting?.count ?? 1;
  return count > 1
    ? `Delete ${props.what} and ${count - 1} later version${count > 2 ? "s" : ""}?`
    : `Delete ${props.what}?`;
});
const detail = computed(() =>
  (props.deleting?.count ?? 1) > 1
    ? "This version goes, and every version that came after it. There is no undo."
    : "It will be gone for good. There is no undo.",
);

const actions = ref<HTMLElement | null>(null);
watch(
  () => props.deleting,
  async (value) => {
    if (!value) return;
    await nextTick();
    // The safe answer is the one that takes focus.
    actions.value?.querySelector<HTMLElement>(".keep")?.focus();
  },
);
</script>

<template>
  <BaseDialog
    :open="!!deleting"
    title-id="delete-title"
    close-label="Close"
    modal-class="leave-modal"
    @close="emit('cancel')"
  >
    <div class="leave-content">
      <h2 id="delete-title">{{ title }}</h2>
      <p v-if="deleting?.count">{{ detail }}</p>
      <p v-if="error" class="edit-bar-problem" role="alert">{{ error }}</p>
      <div ref="actions" class="leave-actions">
        <button
          v-if="deleting?.count"
          type="button"
          class="button small destructive"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ pending ? "Deleting…" : "Delete" }}
        </button>
        <button type="button" class="text-button keep" @click="emit('cancel')">
          Keep it
        </button>
      </div>
    </div>
  </BaseDialog>
</template>
