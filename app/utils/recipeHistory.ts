import type { RecipeBranch, RecipeHistory, RecipeVersion } from "#shared/types/recipe";

// A line's history as the view walks it: who was made from whom, what branched
// off where, and what each version is called. The server sends the line flat
// and oldest first; the shape is built here, once per read.

export type HistoryTree = {
  root: RecipeVersion;
  // Progressions of a version, oldest first. More than one is a fork.
  children: Map<string, RecipeVersion[]>;
  // Separate recipes that branched off a version, by their entry points.
  variants: Map<string, RecipeBranch[]>;
  // "Original", "Version 2", … by when each was made. Titles repeat along a
  // line, so this is what tells two versions apart in a list and to a screen
  // reader.
  label: (id: string) => string;
};

export function historyTree(history: RecipeHistory): HistoryTree | null {
  const root = history.versions.find((version) => version.id === history.lineId);
  if (!root) return null;
  const children = new Map<string, RecipeVersion[]>();
  for (const version of history.versions) {
    if (!version.progressionOf) continue;
    children.set(version.progressionOf, [...(children.get(version.progressionOf) ?? []), version]);
  }
  const variants = new Map<string, RecipeBranch[]>();
  for (const branch of history.variants) {
    variants.set(branch.variantOf, [...(variants.get(branch.variantOf) ?? []), branch]);
  }
  const order = new Map(history.versions.map((version, index) => [version.id, index + 1]));
  return {
    root,
    children,
    variants,
    label: (id) => (id === root.id ? "Original" : `Version ${order.get(id)}`),
  };
}

// Whether there is anything to look back on. Most recipes are one version,
// never branched and from nowhere; they show no history at all.
export const hasHistory = (history: RecipeHistory) =>
  history.versions.length > 1 || history.variants.length > 0 || history.origin !== null;

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatSaved = (iso: string) => WHEN.format(new Date(iso));

// What every row of the tree needs from the page it is on, handed down the
// recursion whole rather than as five props at every level.
export type HistoryContext = {
  tree: HistoryTree;
  // The version on the page.
  current: string;
  // Which version is being pinned, if any, and whether a deletion is out.
  pinning: string | null;
  deleting: boolean;
  pin: (id: string) => void;
  remove: (id: string) => void;
};

// A version's label as it reads inside a sentence: "Delete version 3?",
// "Delete the original?".
export const versionName = (label: string | undefined) =>
  !label ? "this version" : label === "Original" ? "the original" : label.toLowerCase();
