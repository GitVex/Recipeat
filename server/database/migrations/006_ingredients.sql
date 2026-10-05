-- Canonical ingredients (#154): every table the canonization pipeline needs,
-- in one migration, though alias lookup (#158) is the first to use them. The
-- app's own key (ingredients.id) is an ingredient's identity; FoodData
-- Central is enrichment, so an ingredient without an FDC entry still has one.
--
-- FDC data is loaded by a script, never by a migration.

-- Trigram matching for FDC retrieval. Installed in public, whatever the
-- search_path, so every schema finds it under one name.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- SR Legacy and Foundation only, with the release each row came from.
-- search_text is the description's comma parts reversed plus the category,
-- what retrieval matches against.
CREATE TABLE fdc_foods (
    fdc_id INT PRIMARY KEY,
    data_type TEXT NOT NULL CHECK (data_type IN ('sr_legacy_food', 'foundation_food')),
    description TEXT NOT NULL,
    food_category TEXT,
    search_text TEXT NOT NULL,
    release TEXT NOT NULL
);

CREATE INDEX fdc_foods_trgm_idx ON fdc_foods USING gin (search_text public.gin_trgm_ops);
CREATE INDEX fdc_foods_fts_idx ON fdc_foods USING gin (to_tsvector('english', search_text));

CREATE TABLE fdc_portions (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fdc_id INT NOT NULL REFERENCES fdc_foods ON DELETE CASCADE,
    amount NUMERIC CHECK (amount > 0),
    modifier TEXT,
    measure_unit TEXT,
    gram_weight NUMERIC NOT NULL CHECK (gram_weight > 0)
);

CREATE INDEX fdc_portions_fdc_idx ON fdc_portions (fdc_id);

-- Pastes, ground spices…: a category's members share a volume-to-weight
-- conversion until someone measures the ingredient itself (#155).
CREATE TABLE ingredient_categories (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    categorical_modifier TEXT,
    categorical_weighttograms NUMERIC CHECK (categorical_weighttograms > 0)
);

CREATE TABLE ingredients (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    fdc_id INT REFERENCES fdc_foods,
    -- A proxy is the closest entry for nutrition and density, never the same
    -- food.
    fdc_match TEXT CHECK (fdc_match IN ('exact', 'proxy')),
    category INT REFERENCES ingredient_categories,
    density_g_per_ml NUMERIC CHECK (density_g_per_ml > 0),
    -- A retired duplicate forwards to the one that stays, until every recipe
    -- is re-keyed. Lookup follows it to the end.
    merged_into INT REFERENCES ingredients CHECK (merged_into <> id),

    CHECK ((fdc_id IS NULL) = (fdc_match IS NULL))
);

-- One key per name per language: a second, different key for the same alias
-- is a collision, kept out by the primary key and sent to review.
-- alias_norm is normalizeName's output; lang the primary subtag of the
-- recipe's source_lang.
CREATE TABLE ingredient_aliases (
    alias_norm TEXT NOT NULL CHECK (alias_norm <> ''),
    lang TEXT NOT NULL CHECK (lang ~ '^[a-z]{2,8}$'),
    ingredient_id INT NOT NULL REFERENCES ingredients,
    source TEXT NOT NULL,
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (alias_norm, lang)
);

CREATE INDEX ingredient_aliases_ingredient_idx ON ingredient_aliases (ingredient_id);

CREATE TABLE ingredient_portions (
    ingredient_id INT NOT NULL REFERENCES ingredients ON DELETE CASCADE,
    unit TEXT NOT NULL,
    modifier TEXT,
    grams NUMERIC NOT NULL CHECK (grams > 0),
    source TEXT NOT NULL CHECK (source IN ('fdc', 'category', 'community')),
    n_samples INT CHECK (n_samples > 0),

    UNIQUE NULLS NOT DISTINCT (ingredient_id, unit, modifier)
);

-- One measurement per cook per unit; the median of these, outliers filtered,
-- overrides the category from three cooks on (#155).
CREATE TABLE ingredient_samples (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ingredient_id INT NOT NULL REFERENCES ingredients ON DELETE CASCADE,
    owner_sub TEXT NOT NULL,
    unit TEXT NOT NULL,
    grams NUMERIC NOT NULL CHECK (grams > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (ingredient_id, owner_sub, unit)
);

-- Recipes waiting to be keyed. A re-save resets its row; the worker deletes
-- it once processed.
CREATE TABLE canonization_queue (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipe_id UUID NOT NULL UNIQUE REFERENCES recipes (id) ON DELETE CASCADE,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_try_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT
);

CREATE INDEX canonization_queue_next_idx ON canonization_queue (next_try_at);

-- Every model decision, and every alias collision, which waits here with
-- outcome 'review' until a review queue (#156) exists. Alias hits are not
-- logged. Outlives the recipe it came from.
CREATE TABLE canonization_decisions (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipe_id UUID REFERENCES recipes (id) ON DELETE SET NULL,
    name_raw TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    lang TEXT NOT NULL,
    search_terms JSONB,
    candidates JSONB,
    picks JSONB,
    outcome TEXT NOT NULL CHECK (outcome IN ('exact', 'proxy', 'none', 'review')),
    ingredient_id INT REFERENCES ingredients,
    model TEXT,
    prompt_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX canonization_decisions_review_idx ON canonization_decisions (created_at) WHERE outcome = 'review';
