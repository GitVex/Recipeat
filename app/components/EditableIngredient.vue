<script setup lang="ts">
import type { IngredientEdit } from "#shared/utils/recipeDraft";
import { LIMITS } from "#shared/utils/recipeLimits";

// An ingredient line of a recipe being edited. It reads like any other until
// tapped; then its three parts — amount, name, note — are typed into where
// they stand, and it reads again once focus leaves the line.
const props = defineProps<{
  row: IngredientEdit;
  // How the line reads when not being typed into: the amount in the chosen
  // units for an untouched line, what was typed for an edited one.
  shown: { amount: string | null; name: string; extra: string | null };
  index: number;
}>();

const active = ref(false);
const line = ref<HTMLElement | null>(null);
const amountInput = ref<HTMLInputElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);

// The name can take what the line's other two parts leave of its limit, so
// the line the server rebuilds from them still fits.
const nameLimit = LIMITS.ingredient - LIMITS.quantity - LIMITS.extra - 3;

async function activate(event?: Event) {
  active.value = true;
  await nextTick();
  // Tapping the amount starts there; anywhere else starts at the name.
  const onAmount = (event?.target as HTMLElement | undefined)?.closest(".amount");
  const target = onAmount || !props.row.name ? amountInput.value : nameInput.value;
  target?.focus();
  if (target) revealAboveKeyboard(target);
}

// Closed once focus has settled outside the line. Not from the event alone:
// opening removes the focused reading of it, which reports a focusout to
// nowhere just before the inputs take focus.
function leave() {
  requestAnimationFrame(() => {
    if (!line.value?.contains(document.activeElement)) active.value = false;
  });
}

const empty = computed(() => !props.row.amount.trim() && !props.row.name.trim() && !props.row.extra.trim());

// The line as it reads, which is also what it is called.
const reading = computed(() =>
  [props.shown.amount, props.shown.name, props.shown.extra].filter(Boolean).join(" "),
);

// A line just added is there to be typed into.
onMounted(() => {
  if (!props.row.from && empty.value) activate();
});
</script>

<template>
  <span ref="line" class="ingredient-line" @focusout="leave">
    <span v-if="active" class="ingredient-inputs" @keydown.esc.stop.prevent="active = false">
      <input
        ref="amountInput"
        v-model="row.amount"
        class="editable-input amount"
        placeholder="Amount"
        aria-label="Amount"
        :maxlength="LIMITS.quantity"
        :size="Math.max(row.amount.length, 6)"
        @keydown.enter.prevent="active = false"
      />
      <input
        ref="nameInput"
        v-model="row.name"
        class="editable-input"
        placeholder="Ingredient"
        aria-label="Ingredient"
        :maxlength="nameLimit"
        :size="Math.max(row.name.length, 10)"
        @keydown.enter.prevent="active = false"
      />
      <input
        v-model="row.extra"
        class="editable-input ingredient-extra"
        placeholder="Note"
        aria-label="Note"
        :maxlength="LIMITS.extra"
        :size="Math.max(row.extra.length, 5)"
        @keydown.enter.prevent="active = false"
      />
    </span>
    <span
      v-else
      class="editable"
      :class="{ empty }"
      role="button"
      tabindex="0"
      :aria-label="`Edit ingredient ${index + 1}: ${empty ? 'new ingredient' : reading}`"
      @click="activate"
      @keydown.enter.prevent="activate()"
      @keydown.space.prevent="activate()"
      ><template v-if="empty">New ingredient</template
      ><template v-else
        ><template v-if="shown.amount"
          ><span class="amount">{{ shown.amount }}</span>{{ " " }}</template
        >{{ shown.name }}<template v-if="shown.extra"
          >{{ " " }}<span class="ingredient-extra">{{ shown.extra }}</span></template
        ></template
      ></span
    >
  </span>
</template>
