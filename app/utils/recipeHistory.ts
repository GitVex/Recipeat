import type { RecipeBranch, RecipeChanges, RecipeHistory, RecipeVersion } from "#shared/types/recipe";
import { describeChanges } from "#shared/utils/recipeDiff";

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

// The straight path from the original down to a version, oldest first: what
// a recipe page shows of its line. The rest of the tree is the lineage page's.
export function pathTo(history: RecipeHistory, id: string): RecipeVersion[] {
  const byId = new Map(history.versions.map((version) => [version.id, version]));
  const path: RecipeVersion[] = [];
  for (let at = byId.get(id); at; at = at.progressionOf ? byId.get(at.progressionOf) : undefined) {
    path.unshift(at);
  }
  return path;
}

// Whether there is anything to look back on. Most recipes are one version,
// never branched and from nowhere; they show no history at all.
export const hasHistory = (history: RecipeHistory) =>
  history.versions.length > 1 || history.variants.length > 0 || history.origin !== null;

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatSaved = (iso: string) => WHEN.format(new Date(iso));

// A version's label as it reads inside a sentence: "Delete version 3?",
// "Delete the original?".
export const versionName = (label: string | undefined) =>
  !label ? "this version" : label === "Original" ? "the original" : label.toLowerCase();

// What a lineage node says above its lists: the changes that are not an
// ingredient or a step. "Same as the original" when there is nothing at all.
export function changeHeadline(changes: RecipeChanges): string | null {
  const phrases = describeChanges({
    ...changes,
    ingredients: { added: 0, removed: 0, changed: 0, items: [] },
    steps: { added: 0, removed: 0, changed: 0, items: [] },
  });
  if (phrases.length) return phrases.join(" · ");
  const quiet = !changes.ingredients.items.length && !changes.steps.items.length;
  return quiet ? "Same as the original" : null;
}

// How many more changed than a node lists.
export const unlisted = (list: RecipeChanges["ingredients"] | RecipeChanges["steps"]) =>
  list.added + list.removed + list.changed - list.items.length;

// How a version differs from the original of its line, as one line of text:
// what tells two versions with the same title apart. Null on the original.
export function changeSummary(version: RecipeVersion): string | null {
  if (!version.changes) return null;
  const phrases = describeChanges(version.changes);
  return phrases.length ? phrases.join(" · ") : "Same as the original";
}
