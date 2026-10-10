<script setup lang="ts">
import type { ExtractedRecipe, SavedRecipe } from "#shared/types/recipe";
import { ingredientUntouched, parseMinutes } from "#shared/utils/recipeDraft";
import { heatSetting, stoveCuts } from "#shared/utils/heat";
import { LIMITS } from "#shared/utils/recipeLimits";
import { formatFactor, stepPortions, UNSCALED } from "#shared/utils/recipeScale";
import {
  anchorOf,
  hasConvertible,
  ingredientText,
  partText,
  splitStepNumber,
  stepTexts,
} from "#shared/utils/recipeText";
import type { RecipeEditor } from "~/composables/useRecipeEditor";

// A recipe as it reads, wherever it is open: the dialog, the collection's
// preview, and its own page. What can be done with it goes in the slot, between
// the title and the ingredients. Given an editor, every field of it can be
// tapped and typed into where it stands. A stored recipe on its own page is
// both: read — and scaled — or edited, with a switch between the two.
const props = withDefaults(
  defineProps<{
    recipe: ExtractedRecipe;
    titleId: string;
    titleTag?: "h1" | "h2";
    editor?: RecipeEditor;
    // A stored recipe, which can be scaled while it is read.
    scalable?: boolean;
    // A picture shown in place of the recipe's own `image`, never saved as it.
    banner?: string | null;
  }>(),
  { titleTag: "h2", editor: undefined, scalable: false, banner: null },
);

// Reading is where a recipe opens. Without a reading side to switch to, as
// for a fresh import, an editor is always editing.
const mode = ref<"view" | "edit">("view");
const editing = computed(() => !!props.editor && (!props.scalable || mode.value === "edit"));
const locked = computed(() => mode.value === "edit" && !!props.editor?.edited.value);
function toggleMode() {
  if (!locked.value) mode.value = mode.value === "view" ? "edit" : "view";
}

const edit = computed(() => (editing.value ? (props.editor?.edit.value ?? null) : null));
const problems = computed(() => props.editor?.problems.value ?? []);

const source = computed(() => sourceLabel(props.recipe.source));
const time = computed(() => formatMinutes(props.recipe.totalTime));

// Amounts print from the parsed quantities and steps from their parts, so an
// amount a step restates is the ingredient's, not a copy of it.
const recipe = toRef(props, "recipe");
const { system, toggle } = useUnitSystem(recipe);
const convertible = computed(() => hasConvertible(props.recipe));
const lang = computed(() => props.recipe.source_lang);

// Scaled while read; editing shows the amounts as stored.
const scaler = props.scalable ? useRecipeScale(recipe as Ref<SavedRecipe>, system) : null;
const scale = computed(() => (scaler && !editing.value ? scaler.scale.value : UNSCALED));
const scaled = computed(() => scale.value.factor !== 1);

const ingredients = computed(() =>
  props.recipe.ingredients.map((ingredient) => {
    const anchor = scaler ? anchorOf(ingredient, lang.value, system.value) : null;
    return {
      id: ingredient.id,
      ...ingredientText(ingredient, lang.value, system.value, scale.value),
      // What setting this line starts from: the number shown now, in the
      // unit it is shown in.
      anchor: anchor && {
        unit: anchor.unit,
        base: anchor.value,
        current:
          scale.value.anchor === ingredient.id && scale.value.value !== null
            ? scale.value.value
            : Math.round(anchor.value * scale.value.factor * 100) / 100,
      },
    };
  }),
);
const portionsShown = computed(() =>
  scaler?.portions.value == null
    ? null
    : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(scaler.portions.value),
);
// Servings and time, as the reading-mode copy says them.
const readerFacts = computed(() =>
  [
    (portionsShown.value ?? props.recipe.portions) && `Serves ${portionsShown.value ?? props.recipe.portions}`,
    time.value,
  ]
    .filter(Boolean)
    .join(" · "),
);
// An ingredient as one line of text: "500 g (not scaled) flour, type 00", or
// with no amount for the marker to sit beside, "olive oil, to taste (not scaled)".
function readerLine(line: { amount: string | null; name: string; extra: string | null; unscaled?: boolean }) {
  const note = line.unscaled ? " (not scaled)" : "";
  const food = line.extra ? `${line.name}, ${line.extra}` : line.name;
  return line.amount ? `${line.amount}${note} ${food}` : `${food}${note}`;
}
const byId = computed(
  () => new Map(props.recipe.ingredients.map((ingredient) => [ingredient.id, ingredient])),
);
// A heat level shows its setting on the account's stove beside the words
// (#110); signed out, or no stove that has one, it reads as written.
const { preferences } = usePreferences();
const steps = computed(() =>
  stepTexts(props.recipe.steps).map(({ number, parts }, index) => {
    const step = props.recipe.steps[index]!;
    return {
      id: step.id,
      number,
      parts: parts.map((part) => ({
        ...partText(part, step, byId.value, lang.value, system.value, scale.value),
        setting: part.type === "heat" ? heatSetting(part.level, preferences.value) : null,
      })),
    };
  }),
);

// Heat levels and no stove to show them on: signed in, offered a way to set
// one up (#109). Gas is a stove set up, with nothing to show.
const offerStove = computed(
  () =>
    !!preferences.value &&
    preferences.value.stoveKind !== "gas" &&
    !stoveCuts(preferences.value) &&
    props.recipe.steps.some((step) => step.parts.some((part) => part.type === "heat")),
);

// Being edited: a line reads as it did until it is changed, and as it was
// typed after — the structure of a changed one is only known once saved.
const ingredientRows = computed(() =>
  (edit.value?.ingredients ?? []).map((row) => ({
    row,
    shown:
      row.from && ingredientUntouched(row, lang.value)
        ? ingredientText(row.from, lang.value, system.value)
        : { amount: row.amount.trim() || null, name: row.name, extra: row.extra.trim() || null },
  })),
);
const stepsById = computed(() => new Map(steps.value.map((step) => [step.id, step])));
const stepRows = computed(() => {
  const rows = edit.value?.steps ?? [];
  const byNumber = !!props.editor?.inOrder.value && rows.some((row) => row.number !== null);
  return rows.map((row, index) => {
    const start = row.from
      ? row.number !== null
        ? (splitStepNumber(row.from.originalText)?.rest ?? row.from.originalText)
        : row.from.originalText
      : null;
    const untouched = row.from && row.text === start ? stepsById.value.get(row.from.id) : null;
    return {
      row,
      number: byNumber ? row.number : index + 1,
      parts: untouched?.parts ?? [{ text: row.text, amount: false }],
    };
  });
});
const print = () => window.print();

// A duration as it will be saved, once it is one.
const typedTime = computed(() => {
  const minutes = edit.value ? parseMinutes(edit.value.totalTime) : null;
  return minutes ? formatMinutes(minutes) : edit.value?.totalTime;
});
</script>

<template>
  <img
    v-if="banner ?? recipe.image"
    class="detail-image"
    :src="(banner ?? recipe.image)!"
    :alt="recipeTitle(recipe)"
  />
  <div class="detail-content">
    <div class="eyebrow">
      <template v-if="edit"
        >{{ source.toUpperCase() }} ·
        <EditableField
          v-model="edit.totalTime"
          label="total time"
          placeholder="ADD TIME"
          :invalid="problems.includes('totalTime')"
          >{{ typedTime?.toUpperCase() }}</EditableField
        ></template
      >
      <template v-else>{{
        [source, time].filter(Boolean).join(" · ").toUpperCase()
      }}</template>
    </div>
    <div class="title-row">
      <component
        :is="titleTag"
        :id="titleId"
        class="detail-title"
        :class="{ untitled: edit ? !edit.title.trim() : !recipe.title }"
      >
        <EditableField
          v-if="edit"
          v-model="edit.title"
          label="title"
          placeholder="Untitled recipe"
          :maxlength="LIMITS.title"
          multiline
        />
        <template v-else>{{ recipeTitle(recipe) }}</template>
      </component>
      <div class="title-controls">
        <ModeToggle
          v-if="editor && scalable"
          :mode="editing ? 'edit' : 'view'"
          :locked="locked"
          @toggle="toggleMode"
        />
        <!-- Prints what is read: amounts at this scale, in these units. -->
        <button
          v-if="editor && scalable && !editing"
          type="button"
          class="unit-toggle print-button"
          @click="print"
        >
          <AppIcon name="printer" :size="15" /><span>Print</span>
        </button>
        <!-- Only where switching would change something on the page. -->
        <UnitToggle v-if="convertible" :system="system" @toggle="toggle" />
        <slot name="controls" />
      </div>
    </div>
    <slot />

    <template v-if="edit">
      <h3>
        Ingredients
        <small
          ><EditableField
            v-model="edit.portions"
            label="servings"
            placeholder="Add servings"
            inputmode="decimal"
            :invalid="problems.includes('portions')"
            >Serves {{ edit.portions }}</EditableField
          ></small
        >
      </h3>
      <TransitionGroup tag="ul" name="row" class="edit-list">
        <li v-for="({ row, shown }, index) in ingredientRows" :key="row.key">
          <EditableIngredient :row="row" :shown="shown" :index="index" />
          <RowControls
            what="ingredient"
            :index="index"
            :count="ingredientRows.length"
            @move="editor!.moveIngredient(index, $event)"
            @remove="editor!.removeIngredient(index)"
          />
        </li>
      </TransitionGroup>
      <button
        type="button"
        class="text-button add-row"
        :disabled="!editor!.canAddIngredient.value"
        @click="editor!.addIngredient()"
      >
        <AppIcon name="plus" :size="16" />{{
          editor!.canAddIngredient.value
            ? "Add ingredient"
            : `A recipe holds up to ${LIMITS.ingredients} ingredients`
        }}
      </button>

      <h3>Let’s make it</h3>
      <TransitionGroup tag="ol" name="row" class="step-list edit-list">
        <li
          v-for="({ row, number, parts }, index) in stepRows"
          :key="row.key"
          :class="{ unnumbered: number === null }"
        >
          <span v-if="number !== null" class="step-mark">{{ number }}.</span>
          <EditableField
            v-model="row.text"
            :label="`step ${index + 1}`"
            placeholder="Describe this step"
            :maxlength="LIMITS.step"
            multiline
            :autofocus="!row.from && !row.text"
            ><template v-for="(part, partIndex) in parts" :key="partIndex"
              ><span v-if="part.amount" class="amount">{{ part.text }}</span
              ><template v-else>{{ part.text }}</template></template
            ></EditableField
          >
          <RowControls
            what="step"
            :index="index"
            :count="stepRows.length"
            @move="editor!.moveStep(index, $event)"
            @remove="editor!.removeStep(index)"
          />
        </li>
      </TransitionGroup>
      <button
        type="button"
        class="text-button add-row"
        :disabled="!editor!.canAddStep.value"
        @click="editor!.addStep()"
      >
        <AppIcon name="plus" :size="16" />{{
          editor!.canAddStep.value ? "Add step" : `A recipe holds up to ${LIMITS.steps} steps`
        }}
      </button>
    </template>

    <template v-else>
      <template v-if="ingredients.length">
        <div class="ingredients-heading">
          <h3>
            Ingredients
            <small v-if="recipe.portions && !scaler">Serves {{ recipe.portions }}</small>
          </h3>
          <div v-if="scaler" class="scale-controls">
            <span
              v-if="portionsShown !== null"
              class="portion-control"
              role="group"
              aria-label="Servings"
            >
              <button
                type="button"
                class="row-control"
                aria-label="Fewer servings"
                :disabled="(scaler.portions.value ?? 0) <= 1"
                @click="scaler.setPortions(stepPortions(scaler.portions.value ?? 1, -1))"
              >
                <AppIcon name="minus" :size="15" />
              </button>
              <span class="portion-count" aria-live="polite">Serves {{ portionsShown }}</span>
              <button
                type="button"
                class="row-control"
                aria-label="More servings"
                @click="scaler.setPortions(stepPortions(scaler.portions.value ?? 1, 1))"
              >
                <AppIcon name="plus" :size="15" />
              </button>
            </span>
            <span v-else-if="scaled" class="scale-factor" aria-live="polite">{{
              formatFactor(scale.factor)
            }}</span>
            <button
              v-if="scaled"
              type="button"
              class="text-button scale-reset"
              @click="scaler.reset()"
            >
              Reset
            </button>
          </div>
        </div>
        <ul>
          <li
            v-for="ingredient in ingredients"
            :key="ingredient.id"
            :class="{ anchor: scale.anchor === ingredient.id }"
          >
            <template v-if="scaler && ingredient.anchor && ingredient.amount"
              ><ScalableAmount
                :text="ingredient.amount"
                :current="ingredient.anchor.current"
                :unit="ingredient.anchor.unit"
                :anchored="scale.anchor === ingredient.id"
                :name="ingredient.name"
                @set="scaler.setAnchor(ingredient.id, $event, ingredient.anchor.base)" /></template
            ><span v-else-if="ingredient.amount" class="amount">{{ ingredient.amount }}</span>
            {{ ingredient.name }}
            <span v-if="ingredient.extra" class="ingredient-extra">{{
              ingredient.extra
            }}</span>
            <span v-if="ingredient.unscaled" class="unscaled-note">not scaled</span>
            <!-- What the page has to add to a line, such as its open question (#173). -->
            <slot name="ingredient" :line-id="ingredient.id" />
          </li>
        </ul>
      </template>
      <template v-if="steps.length">
        <h3>Let’s make it</h3>
        <ol class="step-list">
          <li
            v-for="step in steps"
            :key="step.id"
            :class="{ unnumbered: step.number === null }"
          >
            <span v-if="step.number !== null" class="step-mark">{{ step.number }}.</span>
            <span
              ><template v-for="(part, index) in step.parts" :key="index"
                ><span v-if="part.amount" class="amount">{{ part.text }}</span
                ><span v-if="part.unscaled" class="unscaled-note">not scaled</span
                ><template v-if="!part.amount">{{ part.text }}</template
                ><span v-if="part.setting" class="heat-setting"> · {{ part.setting }}</span></template
              ></span
            >
          </li>
        </ol>
        <p v-if="offerStove" class="stove-offer">
          <NuxtLink to="/profile#stove">Set up your stove</NuxtLink> to see heat levels as its settings.
        </p>
      </template>
    </template>
  </div>
  <!-- What a browser's reading mode shows (#97): the recipe as plain text,
       amounts as the page shows them, none of the controls around it.
       Readability, which Firefox's Reader View runs, decides much of this:
       - at the end of the body (#teleports, the target Nuxt also renders on
         the server), away from the recipe on show, or it takes both;
       - out of sight with a class of its own (.reader-text), since it drops
         anything named "hidden"; inert, so a screen reader skips it;
       - an id and class it scores as an article's ("article", "text"), so it
         wins over the recipe on show;
       - each line in a <p>, the text it scores, and no classes inside, since
         it drops names that look like asides ("extra"). -->
  <Teleport v-if="scalable" to="#teleports">
    <article id="reader-article" class="reader-text" inert>
      <h1>{{ recipeTitle(recipe) }}</h1>
      <p v-if="readerFacts">{{ readerFacts }}</p>
      <template v-if="ingredients.length">
        <h2>Ingredients</h2>
        <ul>
          <li v-for="ingredient in ingredients" :key="ingredient.id">
            <p>{{ readerLine(ingredient) }}</p>
          </li>
        </ul>
      </template>
      <template v-if="steps.length">
        <h2>Steps</h2>
        <ol>
          <li v-for="step in steps" :key="step.id">
            <p>
              <template v-for="(part, index) in step.parts" :key="index"
                >{{ part.text }}{{ part.unscaled ? " (not scaled)" : ""
                }}{{ part.setting ? ` · ${part.setting}` : "" }}</template
              >
            </p>
          </li>
        </ol>
      </template>
    </article>
  </Teleport>
</template>
