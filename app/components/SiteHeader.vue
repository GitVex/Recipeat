<script setup lang="ts">
const emit = defineEmits<{ import: [] }>();
const mobileNav = ref(false);
// Shown once the collection has been read, never fetched for its own sake: a
// signed-out visit to the landing page should not cost a request that 401s.
const { data } = useRecipeListCache();
const count = computed(() => data.value?.recipes.length ?? 0);
</script>

<template>
  <header class="header page-width">
    <NuxtLink class="logo" to="/" aria-label="Recipeat home"
      ><span class="logo-mark"><AppIcon name="book" :size="23" /></span
      >recipeat<span class="logo-dot">.</span></NuxtLink
    >
    <nav :class="{ open: mobileNav }" aria-label="Main navigation">
      <NuxtLink to="/#how-it-works" @click="mobileNav = false"
        >How it works</NuxtLink
      ><NuxtLink to="/#recipes" @click="mobileNav = false"
        >The inspiration shelf</NuxtLink
      ><NuxtLink to="/recipes" @click="mobileNav = false">
        My collection
        <span v-if="count" class="count">{{ count }}</span>
      </NuxtLink>
      <AuthControls />
    </nav>
    <button
      class="button small header-cta"
      @click="
        mobileNav = false;
        emit('import');
      "
    >
      Start your collection <AppIcon name="arrow" :size="16" />
    </button>
    <button
      class="menu-button icon-button"
      aria-label="Toggle navigation"
      :aria-expanded="mobileNav"
      @click="mobileNav = !mobileNav"
    >
      <AppIcon name="menu" />
    </button>
  </header>
</template>
