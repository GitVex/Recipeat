<script setup lang="ts">
import { recipes } from "~/data/recipes";
import type { RisoOptions } from "~/utils/halftone";

// A bench for image filters (#87): an SVG filter and a CSS chain tried on a
// photo at the sizes the site shows photos, on the surfaces it shows them on
// (the current theme's). What works here is copied into utils/halftone.ts or
// the theme's stylesheet.
//
// Development only: reached when NUXT_PUBLIC_LAB is set, a 404 otherwise.
definePageMeta({
  middleware: () => {
    if (!useRuntimeConfig().public.lab)
      return abortNavigation(createError({ statusCode: 404, statusMessage: "Page not found" }));
  },
});
useHead({ title: "Filter lab — Recipeat", meta: [{ name: "robots", content: "noindex" }] });

// The filters' screens are long data URIs; the editor shows them as $CELL,
// $SCREEN_45 and so on, and they go back in before the filter is drawn.
const TOKENS = Object.entries(HALFTONE_TOKENS);
const short = (primitives: string) =>
  TOKENS.reduce((text, [name, uri]) => text.replaceAll(uri, `$${name}`), primitives);
const expand = (primitives: string) =>
  TOKENS.reduce((text, [name, uri]) => text.replaceAll(`$${name}`, uri), primitives);
// Each preset is a filter and the CSS after it.
const PRESETS: Record<string, { svg: string; css: string }> = {
  "Riso, four inks": { svg: short(risoPrimitives(CRATE_RISO)), css: "sepia(0.2)" },
  "Single-ink halftone": { svg: short(halftonePrimitives(4)), css: "sepia(0.3) saturate(0.75)" },
  "Duotone, navy and cream": {
    svg: `<feColorMatrix values=".33 .33 .33 0 0  .33 .33 .33 0 0  .33 .33 .33 0 0  0 0 0 1 0" />
<feComponentTransfer>
  <feFuncR type="table" tableValues=".08 .95" />
  <feFuncG type="table" tableValues=".11 .9" />
  <feFuncB type="table" tableValues=".18 .78" />
</feComponentTransfer>`,
    css: "",
  },
  "No SVG filter": { svg: "", css: "" },
};
const preset = ref("Riso, four inks");
const source = ref(PRESETS[preset.value]!.svg);
const css = ref(PRESETS[preset.value]!.css);
watch(preset, (name) => {
  source.value = PRESETS[name]!.svg;
  css.value = PRESETS[name]!.css;
});

// The riso's knobs, from what the theme prints with. Moving one writes the
// filter afresh, over any hand edits.
const isRiso = computed(() => preset.value === "Riso, four inks");
const live = (): RisoOptions => structuredClone({ ...RISO_DEFAULTS, ...CRATE_RISO });
const riso = reactive<RisoOptions>(live());
watch(riso, () => isRiso.value && (source.value = short(risoPrimitives(riso))), { deep: true });
const resetRiso = () => Object.assign(riso, live());
const INK_NAMES = Object.keys(RISO_DEFAULTS.inks) as (keyof RisoOptions["inks"])[];
const primitives = computed(() => expand(source.value));
const filter = computed(
  () => [source.value.trim() && "url(#lab-filter)", css.value.trim()].filter(Boolean).join(" ") || "none",
);

// The shelf's photos, any address, or a file of your own (it stays in this browser).
const image = ref(recipes[0]!.image!);
const address = ref("");
function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (image.value.startsWith("blob:")) URL.revokeObjectURL(image.value);
  image.value = URL.createObjectURL(file);
}

// The sizes photos are shown at: a list's thumbnail, a shelf card, the
// recipe dialog's header, and whole.
const SIZES = [
  { label: "Thumbnail", width: 46, height: 46 },
  { label: "Card", width: 377, height: 238 },
  { label: "Dialog", width: 650, height: 230 },
  { label: "Whole", width: 900, height: null },
];
// The theme's surfaces, and the two extremes.
const SURFACES = { Cream: "var(--cream)", Paper: "var(--paper)", Wash: "var(--wash)", White: "#fff", Black: "#000" };
const surface = ref("var(--cream)");
const originals = ref(false);

const copied = ref(false);
async function copy() {
  await navigator.clipboard.writeText(
    `<filter id="…" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">\n${source.value}\n</filter>`,
  );
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <section class="lab page-width">
    <div class="eyebrow">DEVELOPMENT</div>
    <h1 class="lab-title">Filter lab</h1>

    <svg class="halftone-filters" aria-hidden="true" width="0" height="0">
      <filter
        id="lab-filter"
        x="0"
        y="0"
        width="100%"
        height="100%"
        color-interpolation-filters="sRGB"
        v-html="primitives"
      />
    </svg>

    <div class="lab-layout">
      <form class="lab-controls" @submit.prevent>
        <label class="lab-field">
          <span>Photo</span>
          <select v-model="image">
            <option v-for="recipe in recipes" :key="recipe.id" :value="recipe.image">{{ recipe.title }}</option>
            <option v-if="!recipes.some((recipe) => recipe.image === image)" :value="image">Your own</option>
          </select>
        </label>
        <label class="lab-field">
          <span>From an address</span>
          <input v-model="address" type="url" placeholder="https://…" @change="address && (image = address)" />
        </label>
        <label class="lab-field">
          <span>From a file</span>
          <input type="file" accept="image/*" @change="upload" />
        </label>

        <label class="lab-field">
          <span>Preset</span>
          <select v-model="preset">
            <option v-for="(_, name) in PRESETS" :key="name">{{ name }}</option>
          </select>
        </label>
        <fieldset v-if="isRiso" class="lab-riso">
          <legend>Riso</legend>
          <label class="lab-field" for="riso-cell">
            <span>Dot spacing <output>{{ riso.cell }} px</output></span>
            <input id="riso-cell" v-model.number="riso.cell" type="range" min="1.5" max="12" step="0.5" />
          </label>
          <div class="lab-inks">
            <label v-for="ink in INK_NAMES" :key="ink" class="lab-ink">
              <input v-model="riso.inks[ink]" type="color" />
              <span>{{ ink }}</span>
            </label>
            <label class="lab-ink">
              <input v-model="riso.paper" type="color" />
              <span>paper</span>
            </label>
          </div>
          <label class="lab-field" for="riso-shift">
            <span>Out of register <output>× {{ riso.shift }}</output></span>
            <input id="riso-shift" v-model.number="riso.shift" type="range" min="0" max="5" step="0.1" />
          </label>
          <label class="lab-field" for="riso-undercolour">
            <span>Colour black takes away <output>{{ Math.round(riso.undercolour * 100) }}%</output></span>
            <input id="riso-undercolour" v-model.number="riso.undercolour" type="range" min="0" max="1" step="0.05" />
          </label>
          <label class="lab-field" for="riso-opacity">
            <span>Ink opacity <output>{{ Math.round(riso.opacity * 100) }}%</output></span>
            <input id="riso-opacity" v-model.number="riso.opacity" type="range" min="0.3" max="1" step="0.05" />
          </label>
          <button type="button" class="text-button" @click="resetRiso">Back to what the theme uses</button>
        </fieldset>
        <label class="lab-field">
          <span>SVG filter primitives, the inside of &lt;filter&gt; ($CELL, $SCREEN_… are the screens)</span>
          <textarea v-model="source" class="lab-source" rows="14" spellcheck="false" />
        </label>
        <label class="lab-field">
          <span>CSS filters after it</span>
          <input v-model="css" type="text" spellcheck="false" />
        </label>
        <p class="lab-applied"><code>filter: {{ filter }}</code></p>

        <label class="lab-field">
          <span>Behind the photo</span>
          <select v-model="surface">
            <option v-for="(value, name) in SURFACES" :key="name" :value="value">{{ name }}</option>
          </select>
        </label>
        <label class="preference-option">
          <input v-model="originals" type="checkbox" /> The original beside each
        </label>
        <button type="button" class="button small" @click="copy">
          {{ copied ? "Copied" : "Copy the <filter>" }}
        </button>
      </form>

      <div class="lab-previews">
        <figure v-for="size in SIZES" :key="size.label" class="lab-preview">
          <figcaption>{{ size.label }}</figcaption>
          <div class="lab-pair" :style="{ background: surface }">
            <img
              :src="image"
              alt=""
              :style="{ filter, width: `${size.width}px`, height: size.height ? `${size.height}px` : 'auto' }"
            />
            <img
              v-if="originals"
              :src="image"
              alt=""
              :style="{ width: `${size.width}px`, height: size.height ? `${size.height}px` : 'auto' }"
            />
          </div>
        </figure>
      </div>
    </div>
  </section>
</template>
