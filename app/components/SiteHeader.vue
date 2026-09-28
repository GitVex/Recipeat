<script setup lang="ts">
const emit = defineEmits<{ import: [] }>();
const route = useRoute();
const mobileNav = ref(false);
// Shown once the collection has been read, never fetched for its own sake: a
// signed-out visit to the landing page should not cost a request that 401s.
const { data } = useRecipeListCache();
// Not before hydration: on the server the header renders before the page has
// read the list, and the browser, which already has it in the payload, must
// start from the same markup.
const hydrated = ref(false);
onMounted(() => (hydrated.value = true));
const count = computed(() => (hydrated.value ? (data.value?.recipes.length ?? 0) : 0));

// ── Collections, under "My recipes" (#73) ─────────────────────────────────
//
// Slides down when the pointer rests on the link, when the link takes
// keyboard focus, and when the chevron beside it is clicked or tapped — hover
// alone would leave touch and keyboard out. Read the first time it opens, and
// only when signed in, so the landing page still costs no request.
const { loggedIn } = useOidcAuth();
const collections = useCollectionListCache();
const open = ref(false);
const reading = ref(false);
const readFailed = ref(false);
const menu = ref<HTMLElement | null>(null);
const chevron = ref<HTMLButtonElement | null>(null);

async function show() {
  open.value = true;
  if (!loggedIn.value || collections.data.value || reading.value) return;
  reading.value = true;
  readFailed.value = false;
  try {
    await collections.reload();
  } catch {
    readFailed.value = true;
  } finally {
    reading.value = false;
  }
}

// A pointer leaving the link for the panel below it crosses no gap, but one
// leaving altogether gets a moment first, so a diagonal move does not snap it
// shut.
//
// A mouse only: a tap sends pointer events of its own before its click, and
// opening on those would have the click on the chevron shut it again.
let closing: ReturnType<typeof setTimeout> | undefined;
function pointerIn(event: PointerEvent) {
  if (event.pointerType !== "mouse") return;
  clearTimeout(closing);
  show();
}
function pointerOut(event: PointerEvent) {
  if (event.pointerType !== "mouse") return;
  clearTimeout(closing);
  closing = setTimeout(() => (open.value = false), 150);
}
onBeforeUnmount(() => clearTimeout(closing));

// The link opens it on focus. The chevron does not, only on click: a tap
// focuses it first, and opening then would have the click shut it again.
function focusIn(event: FocusEvent) {
  if (event.target instanceof HTMLAnchorElement && event.target.classList.contains("nav-recipes-link")) show();
}
function focusOut(event: FocusEvent) {
  if (!menu.value?.contains(event.relatedTarget as Node | null)) open.value = false;
}
function escape() {
  if (!open.value) return;
  open.value = false;
  chevron.value?.focus();
}
const toggle = () => (open.value ? (open.value = false) : show());

// Somewhere was chosen: the panel and the phone menu both close behind it.
watch(
  () => route.fullPath,
  () => {
    open.value = false;
    mobileNav.value = false;
  },
);

const listed = computed(() => collections.data.value?.collections ?? []);
// The panel is a glance, not the page: past this many it says how many more.
const SHOWN = 6;
const countOf = (n: number) => `${n} recipe${n === 1 ? "" : "s"}`;
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
      >
      <div
        ref="menu"
        class="nav-recipes"
        @pointerenter="pointerIn"
        @pointerleave="pointerOut"
        @focusin="focusIn"
        @focusout="focusOut"
        @keydown.esc="escape"
      >
        <NuxtLink class="nav-recipes-link" to="/recipes" @click="mobileNav = false">
          My recipes
          <span v-if="count" class="count">{{ count }}</span>
        </NuxtLink>
        <button
          ref="chevron"
          type="button"
          class="nav-disclosure"
          :aria-expanded="open"
          aria-controls="nav-collections"
          aria-label="Your collections"
          @click="toggle"
        >
          <AppIcon name="down" :size="14" />
        </button>
        <Transition name="dropdown">
          <div v-if="open" id="nav-collections" class="nav-collections">
            <div class="nav-collections-panel">
              <div class="nav-collections-eyebrow">Your collections</div>
              <p v-if="!loggedIn" class="nav-collections-state">
                Sign in to keep recipes in collections.
              </p>
              <p v-else-if="reading && !listed.length" class="nav-collections-state" role="status">
                Gathering your collections…
              </p>
              <p v-else-if="readFailed" class="nav-collections-state" role="alert">
                Your collections couldn’t be read.
              </p>
              <p v-else-if="!listed.length" class="nav-collections-state">
                No collections yet. Add a recipe to one from its page.
              </p>
              <ul v-else class="nav-collections-list">
                <li v-for="collection in listed.slice(0, SHOWN)" :key="collection.id">
                  <NuxtLink class="nav-collection" :to="`/collections/${collection.id}`">
                    <span class="nav-collection-name">{{ collection.name }}</span>
                    <span class="nav-collection-count">{{ countOf(collection.count) }}</span>
                  </NuxtLink>
                </li>
                <li v-if="listed.length > SHOWN" class="nav-collections-more">
                  and {{ listed.length - SHOWN }} more
                </li>
              </ul>
              <NuxtLink v-if="loggedIn" class="nav-collections-all" to="/collections">
                All collections <AppIcon name="arrow" :size="14" />
              </NuxtLink>
            </div>
          </div>
        </Transition>
      </div>
      <AuthControls />
    </nav>
    <button
      class="button small header-cta"
      @click="
        mobileNav = false;
        emit('import');
      "
    >
      Add a recipe <AppIcon name="arrow" :size="16" />
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
