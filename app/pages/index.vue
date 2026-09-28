<script setup lang="ts">
import { recipes } from "~/data/recipes";
const { openRecipe, openImport } = useDialogs();
</script>

<template>
  <div>
    <LandingHero @import="openImport" @preview="openRecipe(recipes[0]!)" />
    <LandingSources />
    <LandingHowItWorks />
    <RecipeShelf :recipes="recipes" @select="openRecipe" />
    <LandingClosing @import="openImport" />
  </div>
</template>
