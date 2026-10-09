<script setup lang="ts">
import {
  groupProblem,
  isPreferenceValue,
  PREFERENCE_KEYS,
  PREFERENCE_SPECS,
  PREFERENCES,
  type PreferenceGroup,
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
// What a group's check (#200) says is wrong with the form; it isn't saved.
const problem = ref<string | null>(null);
// A group (#200) is one folded section, shown while its `when` holds. A
// `hidden` key is set somewhere else, and only carried through the form.
const topPreferences = (Object.entries(PREFERENCES) as [PreferenceKey, PreferenceSpec | PreferenceGroup][]).filter(
  ([, entry]) => entry.kind === "group" || (!entry.theme && !entry.hidden),
);
const shown = (group: PreferenceGroup) => !group.when || form[group.when.key as PreferenceKey] === group.when.value;
const groupKeys = (group: PreferenceGroup) =>
  (Object.entries(group.keys) as [PreferenceKey, PreferenceSpec][]).filter(
    // A slider's thumbs are its own, not rows.
    ([name, spec]) => !spec.hidden && !group.slider?.keys.includes(name),
  );
// A theme's own switches (#87) sit folded under the Theme row, and only while
// that theme is the one picked.
const themeEffects = computed(() =>
  (Object.entries(PREFERENCE_SPECS) as [PreferenceKey, PreferenceSpec][]).filter(
    ([, spec]) => spec.theme && spec.theme === form.theme,
  ),
);
const themeName = computed(
  () => PREFERENCES.theme.options.find((option) => option.value === form.theme)?.label,
);
// What is on the form, as it would be saved. Anything a preference may not
// hold — an empty or out-of-range number — is unset, as each row's
// description says.
function formValues(): Preferences {
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => {
      const text = String(form[key] ?? "").trim();
      const value = !text ? null : PREFERENCE_SPECS[key].kind === "number" ? Number(text) : text;
      return [key, isPreferenceValue(PREFERENCE_SPECS[key], value) ? value : null];
    }),
  ) as Preferences;
}
// A group's slider (#109): where its thumbs sit for what is on the form, and
// between which of its keys; null, there is no slider to show.
function sliderOf(group: PreferenceGroup) {
  const slider = group.slider;
  const values = formValues();
  const thumbs = slider?.thumbs(values);
  if (!slider || !thumbs) return null;
  const [min, max] = slider.bounds.map((key) => values[key as PreferenceKey] as number);
  const [first, second] = slider.keys as [PreferenceKey, PreferenceKey];
  return {
    slider,
    thumbs,
    min: min!,
    max: max!,
    labels: [group.keys[first]!.label, group.keys[second]!.label] as [string, string],
    set: values[first] !== null || values[second] !== null,
  };
}
function moveSlider(group: PreferenceGroup, [first, second]: [number, number]) {
  const [one, two] = group.slider!.keys as [PreferenceKey, PreferenceKey];
  form[one] = String(first);
  form[two] = String(second);
  savePreferences();
}
function resetSlider(group: PreferenceGroup) {
  for (const key of group.slider!.keys) form[key as PreferenceKey] = "";
  savePreferences();
}
// /profile#<group> opens that group: where a recipe page sends someone to set
// up their stove (#109).
const opened = useRoute().hash.slice(1);
async function savePreferences() {
  const body = formValues();
  // Left on the form to put right, rather than put back.
  problem.value = groupProblem(body);
  if (problem.value) {
    saving.value = null;
    return;
  }
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
// The bookmarklet (#136): the page it is clicked on, sent to this Recipeat's
// /get/. The origin is the browser's, which a proxy in front cannot change.
const origin = ref("");
onMounted(() => (origin.value = location.origin));
const bookmarklet = computed(() => `javascript:void(location='${origin.value}/get/'+location.href)`);

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
              <details
                v-if="spec.kind === 'group'"
                v-show="shown(spec)"
                :id="key"
                :open="opened === key"
                class="preference-effects preference-group"
              >
                <summary>
                  <span class="preference-key">
                    <span class="preference-name">{{ spec.label }}</span>
                    <span class="preference-hint">{{ spec.description }}</span>
                  </span>
                </summary>
                <PreferenceRow
                  v-for="[name, keySpec] in groupKeys(spec)"
                  :key="name"
                  v-model="form[name]"
                  :name="name"
                  :spec="keySpec"
                  @change="savePreferences"
                />
                <PreferenceSlider
                  v-if="sliderOf(spec)"
                  :name="key"
                  v-bind="sliderOf(spec)!"
                  @move="moveSlider(spec, $event)"
                  @reset="resetSlider(spec)"
                />
              </details>
              <PreferenceRow
                v-else
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
            <template v-if="problem">{{ problem }}</template>
            <template v-else-if="preferencesRequest.error.value">Preferences aren’t available on this server.</template>
            <template v-else-if="saving === 'saving'">Saving…</template>
            <template v-else-if="saving === 'saved'">Saved to your account.</template>
            <template v-else-if="saving === 'failed'">That didn’t save. Try again.</template>
          </p>
        </form>
      </section>
      <IngredientOptInDialog :open="optingIn" @confirm="optIn" @cancel="notNow" />

      <section id="send" class="profile-preferences profile-send" aria-labelledby="profile-send-heading">
        <h2 id="profile-send-heading">Send a page to Recipeat</h2>
        <div class="preference-row">
          <p class="preference-key">
            <span class="preference-name">Bookmarklet</span>
            <span class="preference-hint"
              >Drag the button to your bookmarks bar. On a recipe page, click it to open that page here,
              ready to bring in.</span
            >
          </p>
          <a v-if="origin" class="button small" :href="bookmarklet" @click.prevent>Send to Recipeat</a>
        </div>
        <p class="preference-hint">
          Or put this site’s address in front of any recipe’s, like
          <code>{{ origin }}/get/https://example.com/recipe</code>.
        </p>
      </section>

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
