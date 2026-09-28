import type { Ref } from "vue";

export function useDialogFocus(dialog: Ref<unknown>) {
  let previousFocus: HTMLElement | null = null;
  let previousOverflow = "";
  watch(dialog, async (current, previous) => {
    if (!import.meta.client) return;
    if (current && !previous) {
      previousFocus = document.activeElement as HTMLElement;
      previousOverflow = document.body.style.overflow;
    }
    document.body.style.overflow = current ? "hidden" : previousOverflow;
    await nextTick();
    // A dialog that just closed is still on the page while it fades, and one
    // dialog can hand over to another in the same tick: focus the one arriving.
    if (current)
      document
        .querySelector<HTMLElement>(".modal-backdrop:not(.dialog-leave-active) .modal-close")
        ?.focus();
    else previousFocus?.focus();
  });
  onBeforeUnmount(() => {
    if (import.meta.client && dialog.value)
      document.body.style.overflow = previousOverflow;
  });
}
