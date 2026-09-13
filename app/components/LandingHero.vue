<script setup lang="ts">
import { photo } from "~/utils/recipePhoto";
const emit = defineEmits<{ import: []; preview: [] }>();
</script>

<template>
  <section class="hero page-width">
    <div class="hero-copy">
      <div class="eyebrow">
        <span class="tiny-line"></span> YOUR RECIPES. ALL TOGETHER.
      </div>
      <h1>
        Good food starts<br />with a little<br /><em>inspiration.</em
        ><span class="title-star">✳</span>
      </h1>
      <p class="hero-description">
        A cookbook photo. A link you love. Grandma’s handwritten note. Turn them
        into recipes you’ll actually cook — all in one happy place.
      </p>
      <button class="button" @click="emit('import')">
        Save your first recipe <AppIcon name="arrow" :size="18" />
      </button>
      <div class="hero-note">
        <AppIcon name="check" :size="15" /> A little less scrolling. A lot more
        cooking.
      </div>
      <div class="community">
        <div class="avatars">
          <img
            :src="photo('photo-1534528741775-53994a69daeb', 80)"
            alt=""
          /><img
            :src="photo('photo-1500648767791-00dcc994a43e', 80)"
            alt=""
          /><img :src="photo('photo-1506794778202-cad84cf45f1d', 80)" alt="" />
        </div>
        <div>
          <span class="community-stars">★★★★★</span>
          <p>Made for people who love good food.</p>
        </div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="photo-frame">
        <img
          class="hero-photo"
          :src="photo('photo-1473093295043-cdd812d0e601', 1200)"
          alt="Fresh green pasta with cherry tomatoes and basil on a ceramic plate"
        />
        <div class="photo-shade"></div>
        <span class="photo-caption">A new favorite is just a save away.</span>
      </div>
      <div class="round-stamp">
        LESS SCROLLING<span><AppIcon name="leaf" :size="29" /></span>MORE
        COOKING
      </div>
      <div class="source-note">
        <span class="source-icon"><AppIcon name="link" :size="17" /></span>
        <div>
          <small>A little inspiration...</small
          ><strong>One link. Endless possibilities.</strong>
        </div>
        <AppIcon name="sparkle" :size="16" />
      </div>
      <button class="floating-recipe" @click="emit('preview')">
        <span class="ready"><span></span> RECIPE, READY TO COOK</span>
        <h3>Creamy tomato<br />& basil pasta</h3>
        <div class="floating-meta">
          <span><AppIcon name="clock" :size="14" /> 25 min</span
          ><span>Easy & delicious</span>
        </div>
        <div class="floating-bottom">
          <span
            ><AppIcon name="check" :size="14" /> Ingredients & steps,
            sorted</span
          ><span class="mini-bookmark"
            ><AppIcon name="bookmark" :size="16"
          /></span>
        </div>
      </button>
      <div class="handwritten">
        From “I should make this”<br /><span>to “what’s for dinner?”</span
        ><span class="hand-arrow">⤴</span>
      </div>
    </div>
  </section>
</template>
