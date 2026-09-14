<script setup lang="ts">
defineProps<{
  open: boolean;
  titleId: string;
  closeLabel: string;
  modalClass: string;
}>();
const emit = defineEmits<{ close: [] }>();
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      ".modal button:not(:disabled), .modal input, .modal textarea, .modal [href]",
    ),
  ];
  const first = elements[0],
    last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<template>
  <div
    v-if="open"
    class="modal-backdrop"
    @keydown="trapFocus"
    @keydown.esc.stop="emit('close')"
    @click.self="emit('close')"
  >
    <section
      :class="['modal', modalClass]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
    >
      <button
        class="modal-close icon-button"
        :aria-label="closeLabel"
        autofocus
        @click="emit('close')"
      >
        <AppIcon name="close" />
      </button>
      <slot />
    </section>
  </div>
</template>
