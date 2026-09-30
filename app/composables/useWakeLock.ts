// Keeping the screen awake while cooking from a phone. Off on every recipe:
// nothing here is remembered. The browser drops the lock whenever the tab is
// hidden, so it is asked for again when the page comes back, if still on.

const REFUSED =
  "Your device wouldn’t keep the screen on. Battery saver may be stopping it.";

export function useWakeLock() {
  // Set after mount, so the server and the browser render the same page.
  const supported = ref(false);
  const on = ref(false);
  const error = ref("");
  let lock: WakeLockSentinel | null = null;

  async function acquire() {
    try {
      const held = await navigator.wakeLock.request("screen");
      // Switched off, or the page left, while the request was out.
      if (!on.value) return void held.release().catch(() => {});
      lock = held;
      error.value = "";
    } catch {
      on.value = false;
      error.value = REFUSED;
    }
  }

  function release() {
    lock?.release().catch(() => {});
    lock = null;
  }

  // Called from the click, which is the user gesture the request wants.
  function toggle() {
    on.value = !on.value;
    error.value = "";
    if (on.value) acquire();
    else release();
  }

  function onVisibility() {
    if (document.visibilityState === "visible" && on.value && (!lock || lock.released))
      acquire();
  }

  onMounted(() => {
    supported.value = "wakeLock" in navigator;
    document.addEventListener("visibilitychange", onVisibility);
  });
  onBeforeUnmount(() => {
    on.value = false;
    document.removeEventListener("visibilitychange", onVisibility);
    release();
  });

  return { supported, on, error, toggle };
}
