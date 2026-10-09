<script setup lang="ts">
import {
  isPreferenceValue,
  PREFERENCE_KEYS,
  PREFERENCES,
  type PreferenceKey,
  type PreferenceSpec,
  type Preferences,
} from "#shared/utils/preferences";

// The signed-in person (#11): who they are to Recipeat, as GET /api/me
// answers it, and what they have kept — the same listing the collection reads,
// from the database rather than this browser. Signing out is here too.
type Me = {
  provider: string;
  subject: string | null;
  profile: { name?: string; preferred_username?: string; email?: string } | null;
};

const { login, logout } = useOidcAuth();
const me = useFetch<Me>("/api/me", { key: "me", retry: 0 });
const list = useRecipeList();

// Neither is an error when there is no session: 401 is the signed-out page.
const failure = computed(() =>
  me.error.value ? failureOf(me.error.value.statusCode) : null,
);
const listFailure = computed(() =>
  list.error.value ? failureOf(list.error.value.statusCode) : null,
);
const recipes = computed(() => list.data.value?.recipes ?? []);

const profile = computed(() => me.data.value?.profile ?? null);
const name = computed(
  () => profile.value?.name || profile.value?.preferred_username || "Your account",
);
const initial = computed(() => name.value.trim().charAt(0).toUpperCase() || "?");
// The provider's id is a config key; what a person knows it as is the
// sign-in they used.
const PROVIDERS: Record<string, string> = { zitadel: "Zitadel" };
const provider = computed(() =>
  me.data.value ? (PROVIDERS[me.data.value.provider] ?? me.data.value.provider) : null,
);

// ── Preferences (#62) ──────────────────────────────────────────────────────

// One row per entry in PREFERENCES, saved as they change: the whole set
// each time, from what is on the form. The form holds text, "" for unset.
const { preferences, request: preferencesRequest } = usePreferences();
const stored = preferencesRequest.data;
const form = reactive({} as Record<PreferenceKey, string>);
// What is saved, which a failed save goes back to.
function showSaved() {
  for (const key of PREFERENCE_KEYS) form[key] = String(preferences.value?.[key] ?? "");
}
watch(preferences, showSaved, { immediate: true });
const saving = ref<"saving" | "saved" | "failed" | null>(null);
// A theme's own switches (#87) sit folded under the Theme row, and only while
// that theme is the one picked.
const ENTRIES = Object.entries(PREFERENCES) as [PreferenceKey, PreferenceSpec][];
// A `hidden` one is set somewhere else, and only carried through the form.
const topPreferences = ENTRIES.filter(([, spec]) => !spec.theme && !spec.hidden);
const themeEffects = computed(() => ENTRIES.filter(([, spec]) => spec.theme && spec.theme === form.theme));
const themeName = computed(
  () => PREFERENCES.theme.options.find((option) => option.value === form.theme)?.label,
);
async function savePreferences() {
  // Anything a preference may not hold — an empty or out-of-range number —
  // is unset, as each row's description says.
  const body = Object.fromEntries(
    PREFERENCE_KEYS.map((key) => {
      const text = String(form[key] ?? "").trim();
      const value = !text ? null : PREFERENCES[key].kind === "number" ? Number(text) : text;
      return [key, isPreferenceValue(PREFERENCES[key], value) ? value : null];
    }),
  ) as Preferences;
  saving.value = "saving";
  try {
    stored.value = await $fetch<{ preferences: Preferences }>("/api/preferences", {
      method: "PUT",
      body,
      retry: 0,
    });
    saving.value = "saved";
  } catch {
    saving.value = "failed";
  }
  showSaved();
}

// Opting in to the ingredient store (#180) asks first, in a dialog, how the
// recipes already saved go through; that answer is saved with it. Opting out
// saves at once. While in, the row says how many questions are waiting.
const optingIn = ref(false);
function changeMatching() {
  if (form.ingredientMatching === "on" && preferences.value?.ingredientMatching !== "on") optingIn.value = true;
  else savePreferences();
}
function optIn(backfill: "batched" | null) {
  optingIn.value = false;
  form.ingredientBackfill = backfill ?? "";
  savePreferences();
}
function notNow() {
  optingIn.value = false;
  showSaved();
}
const optedIn = computed(() => preferences.value?.ingredientMatching === "on");
const waiting = useFetch<{ waiting: number }>("/api/ingredients/waiting", {
  retry: 0,
  server: false,
  immediate: false,
});
watch(optedIn, (on) => on && waiting.refresh(), { immediate: true });

// Signed out, the theme is the one preference there is, kept in a cookie (#87).
const { theme, choose: chooseTheme } = useTheme();
const themeSpec = PREFERENCES.theme;

// The page says "signed out" to a person, and the response says it to
// everything else.
const event = useRequestEvent();
onServerPrefetch(async () => {
  await me;
  if (event && failure.value === "signedOut") setResponseStatus(event, 401);
});

useHead(() => ({
  title: me.data.value ? `${name.value} — Recipeat` : "Your account — Recipeat",
}));
</script>

<template>
  <section class="profile page-width">
    <p v-if="me.status.value === 'pending' && !me.data.value" class="collection-state" role="status">
      Opening your account…
    </p>

    <div v-else-if="failure === 'signedOut'" class="collection-state profile-signed-out">
      <AppIcon name="user" :size="35" />
      <h1>You’re not signed in.</h1>
      <p>Sign in to see your account and the recipes you’ve kept.</p>
      <button class="button" @click="login('zitadel')">
        Sign in <AppIcon name="arrow" />
      </button>
      <div class="preference-row profile-theme">
        <div class="preference-key">
          <span id="preference-theme-label" class="preference-name">{{ themeSpec.label }}</span>
          <span class="preference-hint">{{ themeSpec.description }}</span>
        </div>
        <div class="preference-value preference-options" role="radiogroup" aria-labelledby="preference-theme-label">
          <label
            v-for="option in [{ value: null, label: themeSpec.unset }, ...themeSpec.options]"
            :key="option.label"
            class="preference-option"
          >
            <input
              type="radio"
              name="theme"
              :checked="theme === option.value"
              @change="chooseTheme(option.value)"
            />
            {{ option.label }}
          </label>
        </div>
      </div>
    </div>

    <div v-else-if="failure" class="collection-state" role="alert">
      <h1>We couldn’t open your account.</h1>
      <p>Something went wrong reading it.</p>
      <button class="button" @click="me.refresh()">Try again</button>
    </div>

    <template v-else-if="me.data.value">
      <div class="profile-card">
        <span class="profile-avatar" aria-hidden="true">{{ initial }}</span>
        <div class="eyebrow">YOUR ACCOUNT</div>
        <h1 class="profile-name">{{ name }}</h1>
        <dl class="profile-details">
          <template v-if="profile?.email">
            <dt>Email</dt>
            <dd>{{ profile.email }}</dd>
          </template>
          <template v-if="profile?.preferred_username && profile.preferred_username !== name">
            <dt>Username</dt>
            <dd>{{ profile.preferred_username }}</dd>
          </template>
          <dt>Signed in with</dt>
          <dd>{{ provider }}</dd>
        </dl>
        <button type="button" class="button small profile-sign-out" @click="logout('zitadel')">
          Sign out
        </button>
      </div>

      <section class="profile-preferences" aria-labelledby="profile-preferences-heading">
        <h2 id="profile-preferences-heading">Preferences</h2>
        <form @submit.prevent>
          <fieldset class="preference-list" :disabled="!preferences">
            <template v-for="[key, spec] in topPreferences" :key="key">
              <PreferenceRow
                v-model="form[key]"
                :name="key"
                :spec="spec"
                @change="key === 'ingredientMatching' ? changeMatching() : savePreferences()"
              />
              <p v-if="key === 'ingredientMatching' && optedIn && waiting.data.value?.waiting" class="preference-waiting">
                {{ waiting.data.value.waiting }} question{{ waiting.data.value.waiting === 1 ? "" : "s" }} waiting on
                your recipes.
              </p>
              <details v-if="key === 'theme' && themeEffects.length" class="preference-effects">
                <summary>{{ themeName }} effects</summary>
                <PreferenceRow
                  v-for="[effect, effectSpec] in themeEffects"
                  :key="effect"
                  v-model="form[effect]"
                  :name="effect"
                  :spec="effectSpec"
                  @change="savePreferences"
                />
              </details>
            </template>
          </fieldset>
          <p class="preference-status" role="status">
            <template v-if="preferencesRequest.error.value">Preferences aren’t available on this server.</template>
            <template v-else-if="saving === 'saving'">Saving…</template>
            <template v-else-if="saving === 'saved'">Saved to your account.</template>
            <template v-else-if="saving === 'failed'">That didn’t save. Try again.</template>
          </p>
        </form>
      </section>
      <IngredientOptInDialog :open="optingIn" @confirm="optIn" @cancel="notNow" />

      <section class="profile-recipes" aria-labelledby="profile-recipes-heading">
        <div class="profile-recipes-heading">
          <h2 id="profile-recipes-heading">
            Your recipes
            <span v-if="list.data.value" class="count">{{ recipes.length }}</span>
          </h2>
          <NuxtLink v-if="recipes.length" class="text-button" to="/recipes">
            Open your recipes <AppIcon name="arrow" :size="16" />
          </NuxtLink>
        </div>

        <p v-if="list.status.value === 'pending' && !list.data.value" class="profile-recipes-state" role="status">
          Gathering your recipes…
        </p>
        <div v-else-if="listFailure === 'unavailable'" class="profile-recipes-state">
          Saving isn’t available on this server, so there are no recipes to show.
        </div>
        <div v-else-if="listFailure" class="profile-recipes-state" role="alert">
          <p>We couldn’t read your recipes. They are still there.</p>
          <button class="text-button" @click="list.refresh()">Try again</button>
        </div>
        <p v-else-if="!recipes.length" class="profile-recipes-state">
          Nothing saved yet. A recipe you bring in and keep will show up here.
        </p>
        <ul v-else class="collection-entries profile-entries">
          <li v-for="recipe in recipes" :key="recipe.id">
            <NuxtLink class="collection-entry" :to="`/recipes/${recipe.id}`">
              <RecipeThumb :image="recipe.image" :title="recipe.title" />
              <span class="entry-text">
                <span class="entry-title" :class="{ untitled: !recipe.title }">{{
                  recipeTitle(recipe)
                }}</span>
                <span class="entry-meta"
                  >{{ recipe.ingredientCount }} ingredient{{ recipe.ingredientCount === 1 ? "" : "s" }} ·
                  {{ recipe.stepCount }} step{{ recipe.stepCount === 1 ? "" : "s" }}</span
                >
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
