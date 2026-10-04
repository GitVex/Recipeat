<script setup lang="ts">
import type { Preferences } from "#shared/utils/preferences";

// After a new version is saved, one quiet line (#66): it may be the one to
// keep on paper. Once per version: the page takes it on arriving, so going
// back to it later does not ask again. "Don't suggest this" is a preference,
// and the profile page turns it back on.
const props = defineProps<{ recipeId: string }>();
const pending = usePaperNudge();
const shown = ref(pending.value === props.recipeId);
if (shown.value) pending.value = null;

const print = () => window.print();

const { preferences, request } = usePreferences();
const failed = ref(false);
async function stop() {
  if (!preferences.value) return;
  failed.value = false;
  try {
    request.data.value = await $fetch<{ preferences: Preferences }>("/api/preferences", {
      method: "PUT",
      body: { ...preferences.value, paperNudge: "off" },
      retry: 0,
    });
  } catch {
    failed.value = true;
  }
}
</script>

<template>
  <p v-if="shown && preferences?.paperNudge !== 'off'" class="paper-nudge">
    <span>Got this one right? It may deserve a page in your notebook.</span>
    <button type="button" class="text-button" @click="print">Print</button>
    <button v-if="preferences" type="button" class="text-button" @click="stop">
      {{ failed ? "Couldn’t save that; try again" : "Don’t suggest this" }}
    </button>
    <button type="button" class="icon-button" aria-label="Hide this" @click="shown = false">
      <AppIcon name="close" :size="14" />
    </button>
  </p>
</template>
