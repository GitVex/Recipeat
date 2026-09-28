import type { EditProblem } from "#shared/utils/recipeDraft";

// What stops an edited recipe being saved, in words that say how to fix it.
export const EDIT_PROBLEM: Record<EditProblem, string> = {
  totalTime: "The total time isn’t a duration Recipeat can read — try “1 h 30 min”.",
  portions: "Servings has to be a number, like 4.",
  empty: "A recipe needs at least one ingredient or step.",
};
