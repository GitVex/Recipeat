<script setup lang="ts">
defineProps<{ savedCount: number }>();
const emit = defineEmits<{ import: []; collection: []; browse: [] }>();
const mobileNav = ref(false);
</script>

<template>
  <header class="header page-width">
    <a class="logo" href="#" aria-label="Recipeat home"
      ><span class="logo-mark"><AppIcon name="book" :size="23" /></span
      >recipeat<span class="logo-dot">.</span></a
    >
    <nav :class="{ open: mobileNav }" aria-label="Main navigation">
      <a href="#how-it-works" @click="mobileNav = false">How it works</a
      ><a
        href="#recipes"
        @click="
          mobileNav = false;
          emit('browse');
        "
        >The inspiration shelf</a
      ><button
        @click="
          mobileNav = false;
          emit('collection');
        "
      >
        My collection
        <span v-if="savedCount" class="count">{{ savedCount }}</span>
      </button>
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
