import type { Preferences } from "#shared/utils/preferences";

// The account's preferences (#62), as GET /api/preferences answers them. One
// key, so the profile's form and every recipe read the same copy, and the
// server renders a recipe with them rather than correcting it once loaded.
//
// Null when there are none to have: signed out, or no database. That is the
// cookies' case, which work then as they always have.
export function usePreferences() {
  const request = useFetch<{ preferences: Preferences }>("/api/preferences", {
    key: "preferences",
    retry: 0,
    dedupe: "defer",
  });
  return { preferences: computed(() => request.data.value?.preferences ?? null), request };
}
