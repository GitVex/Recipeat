import type { RecipeBranch, RecipeHistory, RecipeVersion } from "#shared/types/recipe";
import type { HistoryTree } from "~/utils/recipeHistory";

// Where each version sits on the lineage page (#31). Top to bottom is time
// down the line: a version's progressions stand in the generation below it,
// and the separate recipes that branched off it beside them, by their entry
// points only. Each node is as wide as the leaves under it, so no two
// branches ever cross. Vue Flow draws; it does not lay out, so this does.

export type LineageNode =
  | { kind: "version"; id: string; version: RecipeVersion }
  | { kind: "variant"; id: string; branch: RecipeBranch }
  | { kind: "origin"; id: string; origin: NonNullable<RecipeHistory["origin"]> };

export type LineageEdge = { id: string; source: string; target: string; kind: "progression" | "variant" };

// `depth` is the generation, counted down from the top; `slot` is the place
// across, in node widths, and is fractional where a node is centred over a
// fork.
export type PlacedNode = LineageNode & { depth: number; slot: number };

// A node's own id can repeat across kinds — an origin is a version of another
// line — so every node on the canvas is keyed by kind as well.
export const nodeKey = (node: Pick<LineageNode, "kind" | "id">) => `${node.kind}:${node.id}`;

export function layoutLineage(history: RecipeHistory, tree: HistoryTree) {
  const placed: PlacedNode[] = [];
  const edges: LineageEdge[] = [];
  const offset = history.origin ? 1 : 0;

  // Returns how many slots across the subtree took, starting at `slot`.
  function place(version: RecipeVersion, depth: number, slot: number): number {
    const progressions = tree.children.get(version.id) ?? [];
    const variants = tree.variants.get(version.id) ?? [];
    let width = 0;
    for (const child of progressions) {
      edges.push({ id: `p:${child.id}`, source: nodeKey({ kind: "version", id: version.id }), target: nodeKey({ kind: "version", id: child.id }), kind: "progression" });
      width += place(child, depth + 1, slot + width);
    }
    for (const branch of variants) {
      placed.push({ kind: "variant", id: branch.id, branch, depth: depth + 1, slot: slot + width });
      edges.push({ id: `v:${branch.id}`, source: nodeKey({ kind: "version", id: version.id }), target: nodeKey({ kind: "variant", id: branch.id }), kind: "variant" });
      width += 1;
    }
    width = Math.max(width, 1);
    // Centred on what came of it, so a fork reads as one thing splitting.
    placed.push({ kind: "version", id: version.id, version, depth, slot: slot + (width - 1) / 2 });
    return width;
  }

  const width = place(tree.root, offset, 0);
  if (history.origin) {
    placed.push({ kind: "origin", id: history.origin.id, origin: history.origin, depth: 0, slot: (width - 1) / 2 });
    edges.push({ id: `o:${history.origin.id}`, source: nodeKey({ kind: "origin", id: history.origin.id }), target: nodeKey({ kind: "version", id: tree.root.id }), kind: "variant" });
  }
  return { nodes: placed, edges };
}

// What a node on the canvas is handed: itself, and what the page can do to it.
export type LineageNodeData = {
  node: LineageNode;
  // "Original", "Version 3" — for versions of this line only.
  label: string | null;
  current: boolean;
  pinning: string | null;
  deleting: boolean;
  pin: (id: string) => void;
  remove: (id: string) => void;
};
