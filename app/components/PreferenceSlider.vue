<script setup lang="ts">
import type { PreferenceSlider } from "#shared/utils/preferences";

// A group's slider (#109): two thumbs cutting the span from `min` to `max`
// into three areas, each at least one setting wide. Says where it was let
// go, and asks to go back to the default when its keys are set.
const props = defineProps<{
  name: string;
  slider: PreferenceSlider;
  labels: [string, string];
  min: number;
  max: number;
  thumbs: [number, number];
  set: boolean;
}>();
const emit = defineEmits<{ move: [[number, number]]; reset: [] }>();

const first = ref(props.thumbs[0]);
const second = ref(props.thumbs[1]);
watch(
  () => props.thumbs,
  ([a, b]) => {
    first.value = a;
    second.value = b;
  },
);
// A thumb stops one short of the other, and of the end past it.
function keepApart(which: 0 | 1) {
  if (which === 0) first.value = Math.min(Math.max(first.value, props.min + 1), second.value - 1);
  else second.value = Math.max(Math.min(second.value, props.max), first.value + 1);
}
const span = (from: number, to: number) => (from === to ? String(from) : `${from}–${to}`);
const areas = computed(() => {
  const [low, medium, high] = props.slider.areas;
  return `${low} ${span(props.min, first.value - 1)} · ${medium} ${span(first.value, second.value - 1)} · ${high} ${span(second.value, props.max)}`;
});
// Where a setting sits along the track, 0 to 1: the CSS places a mark there on
// the thumb's own path, which stops half a thumb short of each end.
const at = (value: number) => (value - props.min) / (props.max - props.min);
const ticks = computed(() => Array.from({ length: props.max - props.min + 1 }, (_, index) => props.min + index));
// Each area's name under its middle.
const marks = computed(() => {
  const [low, medium, high] = props.slider.areas;
  return [
    { name: low, at: (at(props.min) + at(first.value - 1)) / 2 },
    { name: medium, at: (at(first.value) + at(second.value - 1)) / 2 },
    { name: high, at: (at(second.value) + at(props.max)) / 2 },
  ];
});
</script>

<template>
  <div class="preference-row preference-slider">
    <div class="preference-key">
      <span :id="`preference-${name}-label`" class="preference-name">{{ slider.label }}</span>
      <span :id="`preference-${name}-hint`" class="preference-hint" aria-live="polite">{{ areas }}</span>
    </div>
    <div class="preference-value">
      <div class="slider" :style="{ '--first': at(first), '--second': at(second) }">
        <!-- The ends of the range, and each thumb's value over it. -->
        <div class="slider-above" aria-hidden="true">
          <span class="slider-end" :style="{ '--at': 0 }">{{ min }}</span>
          <span v-if="second !== max" class="slider-end" :style="{ '--at': 1 }">{{ max }}</span>
          <span class="slider-value" :style="{ '--at': at(first) }">{{ first }}</span>
          <span class="slider-value" :style="{ '--at': at(second) }">{{ second }}</span>
        </div>
        <div class="slider-track" role="group" :aria-labelledby="`preference-${name}-label`">
          <span v-for="tick in ticks" :key="tick" class="slider-tick" :style="{ '--at': at(tick) }" />
          <input
            v-model.number="first"
            type="range"
            :min="min"
            :max="max"
            step="1"
            :aria-label="labels[0]"
            :aria-describedby="`preference-${name}-hint`"
            @input="keepApart(0)"
            @change="emit('move', [first, second])"
          />
          <input
            v-model.number="second"
            type="range"
            :min="min"
            :max="max"
            step="1"
            :aria-label="labels[1]"
            :aria-describedby="`preference-${name}-hint`"
            @input="keepApart(1)"
            @change="emit('move', [first, second])"
          />
        </div>
        <div class="slider-below" aria-hidden="true">
          <span v-for="mark in marks" :key="mark.name" class="slider-area" :style="{ '--at': mark.at }">{{
            mark.name
          }}</span>
        </div>
      </div>
      <button v-if="set" type="button" class="text-button slider-reset" @click="emit('reset')">Use the default</button>
    </div>
  </div>
</template>
