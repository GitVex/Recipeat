<script setup lang="ts">
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

      <section class="profile-recipes" aria-labelledby="profile-recipes-heading">
        <div class="profile-recipes-heading">
          <h2 id="profile-recipes-heading">
            Your recipes
            <span v-if="list.data.value" class="count">{{ recipes.length }}</span>
          </h2>
          <NuxtLink v-if="recipes.length" class="text-button" to="/recipes">
            Open your collection <AppIcon name="arrow" :size="16" />
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
