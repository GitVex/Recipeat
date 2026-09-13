<script setup lang="ts">
type Recipe = { id: number; title: string; category: string; time: string; image: string; source: string; ingredients: string[]; steps: string[] }
const photo = (id: string, width = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`
const recipes: Recipe[] = [
  { id: 1, title: 'Creamy tomato & basil pasta', category: 'Weeknight favorite', time: '25 min', image: photo('photo-1473093295043-cdd812d0e601'), source: 'From a website', ingredients: ['250 g pasta', '200 g cherry tomatoes', '100 ml cream', '2 cloves garlic', 'A handful of fresh basil', 'Parmesan, olive oil, salt & pepper'], steps: ['Cook the pasta in generously salted water. Reserve a cup of the cooking water.', 'Sauté the garlic in olive oil. Add tomatoes and cook until soft, then stir in the cream.', 'Toss in the pasta with a splash of cooking water. Finish with basil and Parmesan.'] },
  { id: 2, title: 'The sunshine nourish bowl', category: 'Fresh & feel-good', time: '20 min', image: photo('photo-1511690743698-d9d85f2fbf38'), source: 'From a photo', ingredients: ['1 cup cooked quinoa', '1 ripe avocado', '1 cup roasted seasonal vegetables', 'A handful of mixed greens', '2 tbsp tahini', 'Juice of half a lemon'], steps: ['Arrange quinoa and greens in a wide bowl.', 'Add sliced avocado and roasted vegetables.', 'Mix tahini with lemon and a little water. Drizzle over the bowl and serve.'] },
  { id: 3, title: 'Slow Sunday pancakes', category: 'Worth waking up for', time: '30 min', image: photo('photo-1528207776546-365bb710ee93'), source: 'From a handwritten note', ingredients: ['150 g plain flour', '1 tsp baking powder', '1 egg', '200 ml milk', '1 tbsp melted butter', 'Fresh berries & maple syrup'], steps: ['Whisk flour and baking powder, then mix in the egg, milk, and butter.', 'Cook small ladles of batter in a buttered pan until bubbles form. Flip and cook until golden.', 'Stack high and finish with berries and maple syrup.'] }
]
const mode = ref('link')
const input = ref('')
const fileName = ref('')
const saved = ref<number[]>([])
const selected = ref<Recipe | null>(null)
const importing = ref(false)
const showImport = ref(false)
const collectionOnly = ref(false)
const error = ref('')
const toast = ref('')
const mobileNav = ref(false)
let toastTimer: ReturnType<typeof setTimeout>
let importTimer: ReturnType<typeof setTimeout>
const visibleRecipes = computed(() => collectionOnly.value ? recipes.filter(r => saved.value.includes(r.id)) : recipes)
onMounted(() => { try { const value = JSON.parse(localStorage.getItem('recipeat-saved') || '[]'); if (Array.isArray(value)) saved.value = value.filter(id => recipes.some(r => r.id === id)) } catch {} })
onBeforeUnmount(() => { clearTimeout(toastTimer); clearTimeout(importTimer) })
let previousFocus: HTMLElement | null = null
watch([selected, showImport], async ([recipe, importingModal], [oldRecipe, oldImportingModal]) => {
  if (!import.meta.client) return
  const isOpen = Boolean(recipe || importingModal)
  if (isOpen && !oldRecipe && !oldImportingModal) previousFocus = document.activeElement as HTMLElement
  document.body.style.overflow = isOpen ? 'hidden' : ''
  await nextTick()
  if (isOpen) document.querySelector<HTMLElement>('.modal-close')?.focus()
  else previousFocus?.focus()
})
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = [...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal input, .modal textarea, .modal [href]')]
  const first = elements[0], last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function save(recipe: Recipe) {
  const exists = saved.value.includes(recipe.id)
  saved.value = exists ? saved.value.filter(id => id !== recipe.id) : [...saved.value, recipe.id]
  try { localStorage.setItem('recipeat-saved', JSON.stringify(saved.value)) } catch {}
  toast.value = exists ? 'Recipe removed from your collection' : 'A little deliciousness, saved to your collection'
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 3500)
}
function openImport() { showImport.value = true; error.value = ''; mobileNav.value = false }
function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { error.value = 'Please choose an image file.'; return }
  fileName.value = file.name; error.value = ''
}
function extract() {
  error.value = ''
  if (mode.value === 'link') { try { const url = new URL(input.value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error() } catch { error.value = 'Enter a full recipe URL, such as https://example.com/recipe.'; return } }
  if (mode.value === 'photo' && !fileName.value) { error.value = 'Choose a recipe photo to try the demo.'; return }
  if (mode.value === 'text' && input.value.trim().length < 10) { error.value = 'Paste a few lines of recipe text to try the demo.'; return }
  importing.value = true
  importTimer = setTimeout(() => { importing.value = false; showImport.value = false; selected.value = recipes[mode.value === 'photo' ? 1 : mode.value === 'text' ? 2 : 0] }, 1100)
}
function collection() { collectionOnly.value = true; mobileNav.value = false; document.getElementById('recipes')?.scrollIntoView({ behavior: 'smooth' }) }
</script>

<template>
  <div @keydown.esc="showImport = false; selected = null">
    <header class="header page-width">
      <a class="logo" href="#" aria-label="Recipeat home"><span class="logo-mark"><AppIcon name="book" :size="23" /></span>recipeat<span class="logo-dot">.</span></a>
      <nav :class="{ open: mobileNav }" aria-label="Main navigation">
        <a href="#how-it-works" @click="mobileNav = false">How it works</a><a href="#recipes" @click="collectionOnly = false; mobileNav = false">The inspiration shelf</a><button @click="collection">My collection <span v-if="saved.length" class="count">{{ saved.length }}</span></button>
        <AuthControls />
      </nav>
      <button class="button small header-cta" @click="openImport">Start your collection <AppIcon name="arrow" :size="16" /></button>
      <button class="menu-button icon-button" aria-label="Toggle navigation" :aria-expanded="mobileNav" @click="mobileNav = !mobileNav"><AppIcon name="menu" /></button>
    </header>

    <main>
      <section class="hero page-width">
        <div class="hero-copy">
          <div class="eyebrow"><span class="tiny-line"></span> YOUR RECIPES. ALL TOGETHER.</div>
          <h1>Good food starts<br>with a little<br><em>inspiration.</em><span class="title-star">✳</span></h1>
          <p class="hero-description">A cookbook photo. A link you love. Grandma’s handwritten note. Turn them into recipes you’ll actually cook — all in one happy place.</p>
          <button class="button" @click="openImport">Save your first recipe <AppIcon name="arrow" :size="18" /></button>
          <div class="hero-note"><AppIcon name="check" :size="15" /> A little less scrolling. A lot more cooking.</div>
          <div class="community"><div class="avatars"><img :src="photo('photo-1534528741775-53994a69daeb', 80)" alt="" /><img :src="photo('photo-1500648767791-00dcc994a43e', 80)" alt="" /><img :src="photo('photo-1506794778202-cad84cf45f1d', 80)" alt="" /></div><div><span class="community-stars">★★★★★</span><p>Made for people who love good food.</p></div></div>
        </div>
        <div class="hero-visual">
          <div class="photo-frame"><img class="hero-photo" :src="photo('photo-1473093295043-cdd812d0e601', 1200)" alt="Fresh green pasta with cherry tomatoes and basil on a ceramic plate" /><div class="photo-shade"></div><span class="photo-caption">A new favorite is just a save away.</span></div>
          <div class="round-stamp">LESS SCROLLING<span><AppIcon name="leaf" :size="29" /></span>MORE COOKING</div>
          <div class="source-note"><span class="source-icon"><AppIcon name="link" :size="17" /></span><div><small>A little inspiration...</small><strong>One link. Endless possibilities.</strong></div><AppIcon name="sparkle" :size="16" /></div>
          <button class="floating-recipe" @click="selected = recipes[0]"><span class="ready"><span></span> RECIPE, READY TO COOK</span><h3>Creamy tomato<br>& basil pasta</h3><div class="floating-meta"><span><AppIcon name="clock" :size="14" /> 25 min</span><span>Easy & delicious</span></div><div class="floating-bottom"><span><AppIcon name="check" :size="14" /> Ingredients & steps, sorted</span><span class="mini-bookmark"><AppIcon name="bookmark" :size="16" /></span></div></button>
          <div class="handwritten">From “I should make this”<br><span>to “what’s for dinner?”</span><span class="hand-arrow">⤴</span></div>
        </div>
      </section>

      <section class="source-strip"><div class="page-width strip-inner"><p>INSPIRATION COMES FROM EVERYWHERE.</p><div><AppIcon name="link" /> Recipe websites</div><span class="strip-dot">·</span><div><AppIcon name="camera" /> Photos & screenshots</div><span class="strip-dot">·</span><div><AppIcon name="book" /> Cookbooks & notes</div><span class="strip-dot">·</span><div><AppIcon name="text" /> A simple copy & paste</div></div></section>

      <section id="how-it-works" class="how-section page-width">
        <div class="section-heading"><div><div class="eyebrow">FROM FOUND TO FAVORITE</div><h2>A little magic. <em>Then, dinner.</em></h2></div><p>Keep the good part of every recipe.<br>We’ll take care of the rest.</p></div>
        <div class="steps-grid">
          <article class="step"><div class="step-top"><span class="step-icon peach"><AppIcon name="link" :size="24" /></span><span class="step-number">01</span></div><h3>Find something delicious</h3><p>Drop in a link, snap a cookbook page, or upload that screenshot you’ve been saving.</p><span class="step-detail">Any source. One starting point.</span></article>
          <article class="step"><div class="step-top"><span class="step-icon green"><AppIcon name="sparkle" :size="25" /></span><span class="step-number">02</span></div><h3>Let a little AI do the prep</h3><p>Ingredients, quantities, and instructions, neatly organized. Just the recipe, ready for you.</p><span class="step-detail">Less clutter. More clarity.</span></article>
          <article class="step"><div class="step-top"><span class="step-icon yellow"><AppIcon name="book" :size="24" /></span><span class="step-number">03</span></div><h3>Make it part of your everyday</h3><p>Build a collection that feels like you. Find your favorites and make them again. And again.</p><span class="step-detail">Your own little corner of delicious.</span></article>
        </div>
      </section>

      <section id="recipes" class="recipes-section page-width">
        <div class="section-heading"><div><div class="eyebrow">{{ collectionOnly ? 'SAVED FOR SOMETHING GOOD' : 'THE INSPIRATION SHELF' }}</div><h2>{{ collectionOnly ? 'Your little' : 'Meet your next' }} <em>{{ collectionOnly ? 'collection.' : '“make again.”' }}</em></h2></div><button class="text-button" @click="collectionOnly = !collectionOnly">{{ collectionOnly ? 'Explore recipes' : 'View your collection' }} <AppIcon name="arrow" :size="18" /></button></div>
        <div v-if="visibleRecipes.length" class="recipe-grid"><article v-for="recipe in visibleRecipes" :key="recipe.id" class="recipe-card"><div class="recipe-image-wrap"><button class="image-open" :aria-label="`View ${recipe.title}`" @click="selected = recipe"><img :src="recipe.image" :alt="recipe.title" loading="lazy" /></button><span class="source-chip"><AppIcon :name="recipe.id === 1 ? 'link' : recipe.id === 2 ? 'camera' : 'book'" :size="13" />{{ recipe.source }}</span><button class="save-button" :class="{ saved: saved.includes(recipe.id) }" :aria-label="`${saved.includes(recipe.id) ? 'Unsave' : 'Save'} ${recipe.title}`" :aria-pressed="saved.includes(recipe.id)" @click="save(recipe)"><AppIcon :name="saved.includes(recipe.id) ? 'check' : 'bookmark'" :size="18" /></button></div><div class="recipe-info"><span class="recipe-category">{{ recipe.category }}</span><button class="recipe-title" @click="selected = recipe">{{ recipe.title }}</button><div class="recipe-meta"><span><AppIcon name="clock" :size="14" />{{ recipe.time }}</span><span class="meta-dot">·</span><span>Simple ingredients, big smiles</span></div></div></article></div>
        <div v-else class="empty-collection"><AppIcon name="book" :size="35" /><h3>Your next favorite belongs here.</h3><p>Tap the bookmark on a recipe to save it to your collection.</p><button class="button" @click="collectionOnly = false">Find some inspiration <AppIcon name="arrow" /></button></div>
      </section>

      <section class="closing page-width"><div class="closing-doodle"><AppIcon name="leaf" :size="56" /></div><div><div class="eyebrow">GOOD THINGS ARE WORTH KEEPING</div><h2>Your taste. Your recipes. <em>Your little collection.</em><br>Let’s make something good.</h2></div><button class="button" @click="openImport">Start collecting <AppIcon name="arrow" :size="18" /></button></section>
    </main>
    <footer class="page-width"><a href="#" class="logo"><span class="logo-mark"><AppIcon name="book" :size="19" /></span>recipeat<span class="logo-dot">.</span></a><p>A home for the recipes you love.</p><span>Made with care. And a little appetite. <AppIcon name="heart" :size="14" /></span></footer>

    <div v-if="toast" class="toast" role="status"><AppIcon name="check" :size="18" />{{ toast }}</div>
    <div v-if="showImport || selected" class="modal-backdrop" @keydown="trapFocus" @click.self="showImport = false; selected = null">
      <section v-if="showImport" class="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" tabindex="-1"><button class="modal-close icon-button" aria-label="Close import" autofocus @click="showImport = false"><AppIcon name="close" /></button><div class="eyebrow">A NEW FAVORITE STARTS HERE</div><h2 id="import-title">Bring your <em>inspiration.</em></h2><p>Try the experience with a sample recipe. This demo doesn’t upload your files or extract real content.</p><div class="import-tabs" role="tablist"><button v-for="tab in [{ id: 'link', name: 'Website', icon: 'link' }, { id: 'photo', name: 'Photo', icon: 'camera' }, { id: 'text', name: 'Text', icon: 'text' }]" :key="tab.id" role="tab" :aria-selected="mode === tab.id" :class="{ active: mode === tab.id }" @click="mode = tab.id; input = ''; error = ''"><AppIcon :name="tab.icon" :size="17" />{{ tab.name }}</button></div><form @submit.prevent="extract"><label v-if="mode === 'link'" class="field-label">Recipe URL<input v-model="input" type="url" placeholder="https://your-favorite-food-blog.com/recipe" required /></label><label v-else-if="mode === 'text'" class="field-label">Recipe text<textarea v-model="input" rows="5" placeholder="Paste ingredients and instructions here…" required /></label><label v-else class="file-upload"><AppIcon name="camera" :size="32" /><strong>{{ fileName || 'Choose a photo or screenshot' }}</strong><span>JPG, PNG, or another image format</span><input type="file" accept="image/*" @change="chooseFile" /></label><p v-if="error" role="alert" class="error">{{ error }}</p><button class="button full-width" :disabled="importing">{{ importing ? 'Preparing your sample recipe…' : 'Preview a sample recipe' }}<AppIcon name="sparkle" :size="17" /></button></form><small class="demo-note">Interactive preview · No account needed</small></section>
      <section v-else-if="selected" class="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-title" tabindex="-1"><button class="modal-close icon-button" aria-label="Close recipe" autofocus @click="selected = null"><AppIcon name="close" /></button><img class="detail-image" :src="selected.image" :alt="selected.title" /><div class="detail-content"><div class="eyebrow">SAMPLE RECIPE · {{ selected.time }}</div><h2 id="recipe-title">{{ selected.title }}</h2><button class="button small" @click="save(selected)"><AppIcon :name="saved.includes(selected.id) ? 'check' : 'bookmark'" :size="17" />{{ saved.includes(selected.id) ? 'Saved to your collection' : 'Save to my collection' }}</button><h3>Ingredients <small>Serves 2</small></h3><ul><li v-for="ingredient in selected.ingredients" :key="ingredient">{{ ingredient }}</li></ul><h3>Let’s make it</h3><ol><li v-for="step in selected.steps" :key="step">{{ step }}</li></ol></div></section>
    </div>
  </div>
</template>
