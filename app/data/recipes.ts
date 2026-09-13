import type { Recipe } from "~/types/recipe";
import { photo } from "~/utils/recipePhoto";

export const recipes: Recipe[] = [
  {
    id: 1,
    title: "Creamy tomato & basil pasta",
    category: "Weeknight favorite",
    time: "25 min",
    image: photo("photo-1473093295043-cdd812d0e601"),
    source: "From a website",
    ingredients: [
      "250 g pasta",
      "200 g cherry tomatoes",
      "100 ml cream",
      "2 cloves garlic",
      "A handful of fresh basil",
      "Parmesan, olive oil, salt & pepper",
    ],
    steps: [
      "Cook the pasta in generously salted water. Reserve a cup of the cooking water.",
      "Sauté the garlic in olive oil. Add tomatoes and cook until soft, then stir in the cream.",
      "Toss in the pasta with a splash of cooking water. Finish with basil and Parmesan.",
    ],
  },
  {
    id: 2,
    title: "The sunshine nourish bowl",
    category: "Fresh & feel-good",
    time: "20 min",
    image: photo("photo-1511690743698-d9d85f2fbf38"),
    source: "From a photo",
    ingredients: [
      "1 cup cooked quinoa",
      "1 ripe avocado",
      "1 cup roasted seasonal vegetables",
      "A handful of mixed greens",
      "2 tbsp tahini",
      "Juice of half a lemon",
    ],
    steps: [
      "Arrange quinoa and greens in a wide bowl.",
      "Add sliced avocado and roasted vegetables.",
      "Mix tahini with lemon and a little water. Drizzle over the bowl and serve.",
    ],
  },
  {
    id: 3,
    title: "Slow Sunday pancakes",
    category: "Worth waking up for",
    time: "30 min",
    image: photo("photo-1528207776546-365bb710ee93"),
    source: "From a handwritten note",
    ingredients: [
      "150 g plain flour",
      "1 tsp baking powder",
      "1 egg",
      "200 ml milk",
      "1 tbsp melted butter",
      "Fresh berries & maple syrup",
    ],
    steps: [
      "Whisk flour and baking powder, then mix in the egg, milk, and butter.",
      "Cook small ladles of batter in a buttered pan until bubbles form. Flip and cook until golden.",
      "Stack high and finish with berries and maple syrup.",
    ],
  },
];
