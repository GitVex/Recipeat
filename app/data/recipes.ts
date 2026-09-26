import type { ExtractedRecipe, Ingredient, Step } from "#shared/types/recipe";
import { photo } from "~/utils/recipePhoto";

// A recipe on the shelf: the shared shape plus an id to find it by. A saved
// recipe is one of these; so are the samples below, until the shelf reads the
// collection from the server.
export type ShelfRecipe = ExtractedRecipe & { id: string };

// Written as lines, and shaped the way extraction hands a recipe over before
// the amounts are read out of it. Nothing on the shelf needs more yet.
const ingredients = (lines: string[]): Ingredient[] =>
  lines.map((line, index) => ({
    id: `ingredient_${index + 1}`,
    originalText: line,
    name: line,
    quantityText: null,
    quantity: null,
    extra: null,
  }));

const steps = (lines: string[]): Step[] =>
  lines.map((line, index) => ({
    id: `step_${index + 1}`,
    originalText: line,
    parts: [{ type: "text", value: line }],
    quantities: {},
  }));

export const recipes: ShelfRecipe[] = [
  {
    id: "sample-pasta",
    title: "Creamy tomato & basil pasta",
    source_lang: "en",
    portions: 2,
    image: photo("photo-1473093295043-cdd812d0e601"),
    totalTime: 25,
    ingredients: ingredients([
      "250 g pasta",
      "200 g cherry tomatoes",
      "100 ml cream",
      "2 cloves garlic",
      "A handful of fresh basil",
      "Parmesan, olive oil, salt & pepper",
    ]),
    steps: steps([
      "Cook the pasta in generously salted water. Reserve a cup of the cooking water.",
      "Sauté the garlic in olive oil. Add tomatoes and cook until soft, then stir in the cream.",
      "Toss in the pasta with a splash of cooking water. Finish with basil and Parmesan.",
    ]),
    source: {
      type: "website",
      url: "https://example.com/creamy-tomato-basil-pasta",
      author: null,
      siteName: null,
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  {
    id: "sample-bowl",
    title: "The sunshine nourish bowl",
    source_lang: "en",
    portions: 2,
    image: photo("photo-1511690743698-d9d85f2fbf38"),
    totalTime: 20,
    ingredients: ingredients([
      "1 cup cooked quinoa",
      "1 ripe avocado",
      "1 cup roasted seasonal vegetables",
      "A handful of mixed greens",
      "2 tbsp tahini",
      "Juice of half a lemon",
    ]),
    steps: steps([
      "Arrange quinoa and greens in a wide bowl.",
      "Add sliced avocado and roasted vegetables.",
      "Mix tahini with lemon and a little water. Drizzle over the bowl and serve.",
    ]),
    source: { type: "photo", objectKey: null, originalFilename: null },
  },
  {
    id: "sample-pancakes",
    title: "Slow Sunday pancakes",
    source_lang: "en",
    portions: 2,
    image: photo("photo-1528207776546-365bb710ee93"),
    totalTime: 30,
    ingredients: ingredients([
      "150 g plain flour",
      "1 tsp baking powder",
      "1 egg",
      "200 ml milk",
      "1 tbsp melted butter",
      "Fresh berries & maple syrup",
    ]),
    steps: steps([
      "Whisk flour and baking powder, then mix in the egg, milk, and butter.",
      "Cook small ladles of batter in a buttered pan until bubbles form. Flip and cook until golden.",
      "Stack high and finish with berries and maple syrup.",
    ]),
    source: { type: "text", originalText: "" },
  },
];
