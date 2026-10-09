// Every preference a person can set (#62), and what each may hold. The one
// place to add one: the type, the route's check and the profile's form all
// follow from this. Null is always allowed, and is `unset`.
//
// Read them anywhere with usePreferences().
type Common = { label: string; description: string; unset: string; theme?: string; hidden?: true };
export type PreferenceSpec =
  | (Common & { kind: "choice"; options: readonly { value: string; label: string }[] })
  | (Common & { kind: "number"; min: number; max: number });
// Keys that belong together (#200), folded into one section on the profile.
// Only how they're declared and shown: the stored document stays flat, so a
// key's name is unique across groups. `check` sees the whole set and answers
// what's wrong with it, or null; `when` shows the group only while another key
// holds a value, and hidden, its keys keep what they hold.
export type PreferenceGroup = {
  kind: "group";
  label: string;
  description: string;
  keys: Record<string, PreferenceSpec>;
  check?: (values: Record<string, string | number | null>) => string | null;
  when?: { key: string; value: string };
};
type PreferenceEntry = PreferenceSpec | PreferenceGroup;

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
  // The ingredient store (#173): asked which entry a close match is, and
  // answers go into the store everyone shares. Unset is no.
  ingredientMatching: {
    kind: "choice",
    label: "Contribute to the ingredient store",
    description: "On a recipe, you're asked which ingredient a line means when it's close to one we know. Your answers name ingredients for everyone.",
    unset: "No",
    options: [{ value: "on", label: "Yes" }],
  },
  // How opting in goes through the recipes already saved (#180): read by the
  // trigger in 007_ingredient_matching.sql. `hidden`: the opt-in dialog sets
  // it, not a row of its own, and every opt-in asks again. Unset is all at once.
  ingredientBackfill: {
    kind: "choice",
    hidden: true,
    label: "Existing recipes",
    description: "How your saved recipes are gone through when you start contributing.",
    unset: "All at once",
    options: [{ value: "batched", label: "A batch at a time" }],
  },
  // A whole look (#87): app/assets/themes/<value>.css. Unset is the default.
  theme: {
    kind: "choice",
    label: "Theme",
    description: "How Recipeat looks.",
    unset: "Kitchen notebook",
    options: [{ value: "crate-label", label: "Crate Label" }],
  },
  // Crate Label's print effects (#87), each one its own switch. Unset is on.
  // `theme` is the theme they belong to: the profile shows them only with it.
  grainEffect: {
    kind: "choice",
    theme: "crate-label",
    label: "Paper grain",
    description: "Aged paper behind the page, and a printed rule inside each panel.",
    unset: "On",
    options: [{ value: "off", label: "Off" }],
  },
  stampEffect: {
    kind: "choice",
    theme: "crate-label",
    label: "Stamps",
    description: "Tags inked like rubber stamps, photos perforated like postage.",
    unset: "On",
    options: [{ value: "off", label: "Off" }],
  },
  misprintEffect: {
    kind: "choice",
    theme: "crate-label",
    label: "Misprinted titles",
    description: "A second ink a little off behind the large titles.",
    unset: "On",
    options: [{ value: "off", label: "Off" }],
  },
  halftoneEffect: {
    kind: "choice",
    theme: "crate-label",
    label: "Halftone photos",
    description: "Photos printed like a riso, four inks in dots, true colour under the pointer. Source pages are never touched.",
    unset: "On",
    options: [{ value: "off", label: "Off" }],
  },
  ticketEffect: {
    kind: "choice",
    theme: "crate-label",
    label: "Tickets and banners",
    description: "Notices torn like ticket stubs, buttons cut like label banners.",
    unset: "On",
    options: [{ value: "off", label: "Off" }],
  },
} as const satisfies Record<string, PreferenceEntry>;

// Every key, groups opened up: what is stored, sent and checked.
type Entries = typeof PREFERENCES;
type Grouped = { [K in keyof Entries]: Entries[K] extends { kind: "group"; keys: infer G } ? G : never }[keyof Entries];
type Merged<U> = (U extends unknown ? (u: U) => void : never) extends (m: infer M) => void ? M : never;
type Specs = { [K in keyof Entries as Entries[K] extends { kind: "group" } ? never : K]: Entries[K] } & Merged<Grouped>;

/** Every key in `entries`, its group's keys in its place. Throws on a name two use. */
export function specsOf(entries: Record<string, PreferenceEntry>): Record<string, PreferenceSpec> {
  const specs: Record<string, PreferenceSpec> = {};
  for (const [key, entry] of Object.entries(entries))
    for (const [name, spec] of entry.kind === "group" ? Object.entries(entry.keys) : [[key, entry] as const]) {
      if (name in specs) throw new Error(`Two preferences are called ${name}.`);
      specs[name] = spec;
    }
  return specs;
}

export const PREFERENCE_SPECS = specsOf(PREFERENCES) as unknown as Specs;

export type PreferenceKey = keyof Specs;

type ValueOf<S> = S extends { kind: "choice"; options: readonly { value: infer V }[] }
  ? V
  : S extends { kind: "number" }
    ? number
    : never;

export type Preferences = { -readonly [K in PreferenceKey]: ValueOf<Specs[K]> | null };

export const PREFERENCE_KEYS = Object.keys(PREFERENCE_SPECS) as PreferenceKey[];

/** The first group in `entries` whose check `values` fails, as its message. */
export function groupProblem(
  values: Record<string, string | number | null>,
  entries: Record<string, PreferenceEntry> = PREFERENCES,
): string | null {
  for (const entry of Object.values(entries)) {
    const problem = entry.kind === "group" ? entry.check?.(values) : null;
    if (problem) return problem;
  }
  return null;
}

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
