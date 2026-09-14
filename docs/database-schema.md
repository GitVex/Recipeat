# Recipes

```sql
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    title TEXT,
    source_lang TEXT NOT NULL,
    ingredients JSONB NOT NULL,
    steps JSONB NOT NULL,
    portions NUMERIC,
    source JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (portions IS NULL OR portions > 0),
    CHECK (jsonb_typeof(ingredients) = 'array'),
    CHECK (jsonb_typeof(steps) = 'array'),
    CHECK (source IS NULL OR jsonb_typeof(source) = 'object')
);

CREATE INDEX recipes_owner_sub_idx ON recipes (owner_sub);
```

# Shared types

```ts
type LanguageTag = string;

type Unit =
  | 'g'
  | 'kg'
  | 'mg'
  | 'oz'
  | 'lb'
  | 'ml'
  | 'l'
  | 'cup_us'
  | 'cup_metric'
  | 'tbsp_us'
  | 'tbsp_metric'
  | 'tbsp_au'
  | 'tsp_us'
  | 'tsp_metric'
  | 'fl_oz_us'
  | 'fl_oz_imperial'
  | 'celsius'
  | 'fahrenheit'
  | 'second'
  | 'minute'
  | 'hour'
  | 'mm'
  | 'cm'
  | 'inch'
  | 'count'
  | 'cup'
  | 'tbsp'
  | 'tsp'
  | 'fl_oz';

type QuantityKind =
  | 'mass'
  | 'volume'
  | 'count'
  | 'temperature'
  | 'duration'
  | 'length'
  | 'other';

type Quantity = {
  value: number;
  maxValue: number | null;
  unit: Unit | null;
};
```

# Ingredients JSONB

```ts
type Ingredients = Ingredient[];

type Ingredient = {
  id: string;
  originalText: string;
  name: string;
  // The amount as the model segmented it out of originalText, kept so the
  // quantity parser can be improved and rerun without the model.
  quantityText: string | null;
  quantity: Quantity | null;
};
```

# Steps JSONB

```ts
type Steps = Step[];

type Step = {
  id: string;
  originalText: string;
  parts: StepPart[];
  quantities: Record<string, StepQuantity>;
};

type StepPart =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'measurement';
      quantity: string;
    }
  | {
      type: 'ingredientQuantity';
      ingredientId: string;
    };

type StepQuantity = Quantity & {
  kind: QuantityKind;
  scaleWithPortions: boolean | null;
};
```

# Source JSONB

```ts
type RecipeSource =
  | {
      type: 'website';
      url: string;
      author: string | null;
      retrievedAt: string;
    }
  | {
      type: 'photo';
      objectKey: string;
      originalFilename: string | null;
    }
  | {
      type: 'text';
      originalText: string;
    };
```

# Recipe document

```ts
type Recipe = {
  id: string;
  owner_sub: string;
  title: string | null;
  source_lang: LanguageTag;
  ingredients: Ingredients;
  steps: Steps;
  portions: number | null;
  source: RecipeSource | null;
  created_at: string;
  updated_at: string;
};
```
