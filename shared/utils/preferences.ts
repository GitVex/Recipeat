// Every preference a person can set (#62), and what each may hold. The one
// place to add one: the type, the route's check and the profile's form all
// follow from this. Null is always allowed, and is `unset`.
//
// Read them anywhere with usePreferences().
type Common = { label: string; description: string; unset: string };
export type PreferenceSpec =
  | (Common & { kind: "choice"; options: readonly { value: string; label: string }[] })
  | (Common & { kind: "number"; min: number; max: number });

export const PREFERENCES = {
  unitSystem: {
    kind: "choice",
    label: "Units",
    description: "How amounts are shown.",
    unset: "As written",
    options: [
      { value: "metric", label: "Metric" },
      { value: "imperial", label: "Imperial" },
    ],
  },
  portions: {
    kind: "number",
    label: "Servings",
    description: "What each recipe opens scaled to. Empty opens it as written.",
    unset: "As written",
    // A household, not a canteen.
    min: 1,
    max: 100,
  },
  // The line after a new version is saved (#66). Unset is on.
  paperNudge: {
    kind: "choice",
    label: "Keeping it on paper",
    description: "After a new version, a line suggesting it may deserve a page in your notebook.",
    unset: "Suggest it",
    options: [{ value: "off", label: "Don’t suggest it" }],
  },
  // The one opt-out for shared ingredient data (#147). Unset is in. Off
  // leaves this account's sightings, alias votes and substitutions out of
  // every count, past ones too; it still gets the shared keys.
  sharedIngredients: {
    kind: "choice",
    label: "Contribute to shared ingredient data",
    description: "Ingredient names in your recipes help the app learn new ingredients for everyone. Nothing else of the recipe is shared.",
    unset: "Contribute",
    options: [{ value: "off", label: "Don’t contribute" }],
  },
} as const satisfies Record<string, PreferenceSpec>;

export type PreferenceKey = keyof typeof PREFERENCES;

type ValueOf<S> = S extends { kind: "choice"; options: readonly { value: infer V }[] }
  ? V
  : S extends { kind: "number" }
    ? number
    : never;

export type Preferences = { -readonly [K in PreferenceKey]: ValueOf<(typeof PREFERENCES)[K]> | null };

export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as PreferenceKey[];

export const NO_PREFERENCES = Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, null])) as Preferences;

/** Whether `value` is something `spec` may hold. */
export function isPreferenceValue(spec: PreferenceSpec, value: unknown): boolean {
  if (value === null) return true;
  if (spec.kind === "choice") return spec.options.some((option) => option.value === value);
  return Number.isInteger(value) && (value as number) >= spec.min && (value as number) <= spec.max;
}

/** What `spec` may hold, said to whoever sent something else. */
export const preferenceRule = (spec: PreferenceSpec): string =>
  spec.kind === "choice"
    ? `one of ${spec.options.map((option) => JSON.stringify(option.value)).join(", ")}, or null`
    : `a whole number from ${spec.min} to ${spec.max}, or null`;
