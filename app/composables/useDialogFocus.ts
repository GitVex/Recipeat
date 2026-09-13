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
    if (current) document.querySelector<HTMLElement>(".modal-close")?.focus();
    else previousFocus?.focus();
  });
  onBeforeUnmount(() => {
    if (import.meta.client && dialog.value)
      document.body.style.overflow = previousOverflow;
  });
}
