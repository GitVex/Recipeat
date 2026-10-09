import type { HeatLevel } from "../types/recipe.ts";
import type { Preferences } from "./preferences.ts";

// Which of a cook's stove settings a heat level in a step means (#54). The
// range is cut into low, medium and high where medium and high start; the two
// levels between are the settings either side of a cut. Boost is never
// suggested: the areas run from the lowest setting to the highest.

// Where medium and high start, as fractions of the range, until the cook moves
// them. A stated guess, not measured: induction puts the same fraction of its
// dial into the pan faster, so its cuts sit lower than ceramic's or a coil's.
export const DEFAULT_CUTS = {
  induction: { medium: 0.3, high: 0.65 },
  ceramic: { medium: 0.375, high: 0.75 },
  coil: { medium: 0.4, high: 0.75 },
} as const;

type Stove = Pick<Preferences, "stoveKind" | "stoveLowest" | "stoveHighest" | "stoveMediumFrom" | "stoveHighFrom">;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The setting a level means on the cook's stove, "6" or "6–7", or null: gas,
 * no stove, or a range too small for three areas has nothing honest to say.
 */
export function heatSetting(level: HeatLevel, stove: Stove | null): string | null {
  const kind = stove?.stoveKind;
  const low = stove?.stoveLowest;
  const top = stove?.stoveHighest;
  if (!kind || kind === "gas" || low == null || top == null || top - low < 2) return null;
  const at = (fraction: number) => low + Math.round(fraction * (top - low));
  // The cook's cut wins; a default left beside it moves out of its way.
  let medium = stove.stoveMediumFrom ?? at(DEFAULT_CUTS[kind].medium);
  let high = stove.stoveHighFrom ?? at(DEFAULT_CUTS[kind].high);
  if (stove.stoveMediumFrom == null) medium = clamp(medium, low + 1, (stove.stoveHighFrom ?? top) - 1);
  if (stove.stoveHighFrom == null) high = clamp(high, medium + 1, top);
  // A cook's cut can leave no room beside it (high from 2 on a dial from 1).
  if (!(low < medium && medium < high && high <= top)) return null;
  const [from, to] = {
    low: [low, medium - 1],
    "medium-low": [medium - 1, medium],
    medium: [medium, high - 1],
    "medium-high": [high - 1, high],
    high: [high, top],
  }[level];
  return from === to ? String(from) : `${from}–${to}`;
}
