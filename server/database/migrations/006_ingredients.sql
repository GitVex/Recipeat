-- The central ingredient store (#170, #171): one entry per food, its names in
-- every language, and where it came from. The app's own id is the identity;
-- Open Food Facts and FoodData Central ids hang off it in ingredient_sources,
-- so an entry a cook adds is the same shape with no rows there.
--
-- Seeded once by scripts/seed-ingredients.ts. Recipes link to entries in #172.

-- In public rather than the current schema: the live tests run with
-- search_path set to a schema of their own, which would hide the opclass from
-- every other schema and take the extension with it when they drop theirs.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

CREATE TABLE ingredients (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Empty means nobody has measured it yet; there is no flag beside it.
    density_g_per_ml NUMERIC CHECK (density_g_per_ml > 0),
    density_source TEXT CHECK (density_source IN ('fdc', 'searxng', 'community')),
    density_ref TEXT,               -- FDC portion id or the result's URL
    created_by TEXT,                -- owner_sub; null = seed
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((density_g_per_ml IS NULL) = (density_source IS NULL))
);

CREATE TABLE ingredient_sources (
    ingredient_id BIGINT NOT NULL REFERENCES ingredients ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('off', 'fdc')),
    external_id TEXT NOT NULL,      -- 'en:garlic', '171325'
    PRIMARY KEY (source, external_id, ingredient_id)
);
-- An FDC id may sit on several ingredients (two OFF entries can share one).
CREATE INDEX ingredient_sources_ingredient_idx ON ingredient_sources (ingredient_id);

CREATE TABLE ingredient_names (
    ingredient_id BIGINT NOT NULL REFERENCES ingredients ON DELETE CASCADE,
    lang TEXT NOT NULL,                       -- primary subtag, or 'xx' for every language
    name TEXT NOT NULL,
    is_main BOOLEAN NOT NULL DEFAULT false,   -- first in its language; what a reader sees
    confirmed BOOLEAN NOT NULL,               -- unconfirmed: a close-match candidate only
    source TEXT NOT NULL CHECK (source IN ('off', 'cook', 'searxng')),
    added_by TEXT,                            -- owner_sub; null for off and searxng
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (is_main <= confirmed)
);
-- A name means one entry per language. Accents and plurals are left to the
-- trigram index below, which is what close matches are found by.
CREATE UNIQUE INDEX ingredient_names_lang_name_idx ON ingredient_names (lang, lower(name));
CREATE UNIQUE INDEX ingredient_names_main_idx ON ingredient_names (ingredient_id, lang) WHERE is_main;
CREATE INDEX ingredient_names_trgm_idx ON ingredient_names USING GIN (lower(name) public.gin_trgm_ops);
