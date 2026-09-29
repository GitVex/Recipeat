import type { RecipeBranch, RecipeHistory, RecipeVersion } from "#shared/types/recipe";
import type { HistoryTree } from "~/utils/recipeHistory";

// Where each version sits on the lineage page (#31). Top to bottom is time
// down this line: a version's progressions stand in the generation below it.
// What leaves the line goes sideways instead (#88) — the separate recipes that
// branched off a version stand on its own row, to its right, by their entry
// points only, and the recipe the line itself branched off stands to the left
// of its original. Subtrees are packed row by row, so no two branches ever
// cross or overlap. Vue Flow draws; it does not lay out, so this does.

export type LineageNode =
  | { kind: "version"; id: string; version: RecipeVersion }
  | { kind: "variant"; id: string; branch: RecipeBranch }
  | { kind: "origin"; id: string; origin: NonNullable<RecipeHistory["origin"]> };

// A progression runs down, from a version's foot to the next one's head; a
// branch runs across, from a node's side to the side of the one beside it.
export type LineageEdge = {
  id: string;
  source: string;
  target: string;
  kind: "progression" | "variant";
  direction: "down" | "across";
};

// `depth` is the generation, counted down from the top; `slot` is the place
// across, in node widths, and is fractional where a node is centred over a
// fork.
export type PlacedNode = LineageNode & { depth: number; slot: number };

// A node's own id can repeat across kinds — an origin is a version of another
// line — so every node on the canvas is keyed by kind as well.
export const nodeKey = (node: Pick<LineageNode, "kind" | "id">) => `${node.kind}:${node.id}`;

// A subtree laid out on its own, from its version at depth 0: its nodes, and
// for each row it reaches the leftmost and rightmost slot it takes there.
type Subtree = { nodes: PlacedNode[]; rows: { min: number; max: number }[] };

const shifted = (subtree: Subtree, by: number, down: number): Subtree => ({
  nodes: subtree.nodes.map((node) => ({ ...node, slot: node.slot + by, depth: node.depth + down })),
  rows: subtree.rows.map((row) => ({ min: row.min + by, max: row.max + by })),
});

export function layoutLineage(history: RecipeHistory, tree: HistoryTree) {
  const edges: LineageEdge[] = [];
  const key = (kind: LineageNode["kind"], id: string) => nodeKey({ kind, id });

  function place(version: RecipeVersion): Subtree {
    const progressions = tree.children.get(version.id) ?? [];
    const variants = tree.variants.get(version.id) ?? [];

    // Each progression's subtree, one row down, pushed right until it clears
    // the ones before it on every row they share.
    const below: Subtree = { nodes: [], rows: [] };
    const heads: number[] = [];
    for (const child of progressions) {
      edges.push({ id: `p:${child.id}`, source: key("version", version.id), target: key("version", child.id), kind: "progression", direction: "down" });
      const subtree = place(child);
      // Rows here are counted from the progressions' own row.
      let by = below.nodes.length ? -Infinity : 0;
      subtree.rows.forEach((row, depth) => {
        const taken = below.rows[depth];
        if (taken) by = Math.max(by, taken.max + 1 - row.min);
      });
      const moved = shifted(subtree, by, 1);
      heads.push(moved.nodes.at(-1)!.slot);
      below.nodes.push(...moved.nodes);
      moved.rows.forEach((row, depth) => {
        const taken = below.rows[depth];
        below.rows[depth] = taken ? { min: Math.min(taken.min, row.min), max: Math.max(taken.max, row.max) } : row;
      });
    }

    // Centred over what came of it, so a fork reads as one thing splitting;
    // what branched off it stands beside it, on its own row.
    const slot = heads.length ? (heads[0]! + heads.at(-1)!) / 2 : 0;
    const nodes: PlacedNode[] = [...below.nodes];
    variants.forEach((branch, index) => {
      nodes.push({ kind: "variant", id: branch.id, branch, depth: 0, slot: slot + index + 1 });
      edges.push({ id: `v:${branch.id}`, source: key("version", version.id), target: key("variant", branch.id), kind: "variant", direction: "across" });
    });
    // The version last: a subtree's head is its last node.
    nodes.push({ kind: "version", id: version.id, version, depth: 0, slot });
    const rows = [{ min: slot, max: slot + variants.length }];
    below.rows.forEach((row, depth) => (rows[depth + 1] = row));
    return { nodes, rows };
  }

  const nodes = place(tree.root).nodes;
  const root = nodes.at(-1)!;
  // The recipe this line branched off, to the left of where it began: the
  // same sideways step as a separate recipe, seen from the other end.
  if (history.origin) {
    nodes.push({ kind: "origin", id: history.origin.id, origin: history.origin, depth: 0, slot: root.slot - 1 });
    edges.push({ id: `o:${history.origin.id}`, source: key("origin", history.origin.id), target: key("version", tree.root.id), kind: "variant", direction: "across" });
  }
  const left = Math.min(...nodes.map((node) => node.slot));
  return { nodes: nodes.map((node) => ({ ...node, slot: node.slot - left })), edges };
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
