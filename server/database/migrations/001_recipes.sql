-- The recipes table, and the lineage a recipe can have: a line of
-- progressions, a variant that leaves the line, and the pin that says which
-- version the app means when it says "the recipe". docs/planning.md, under
-- "Recipe lineage", carries the reasoning; this is the shape.

CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- No foreign key on purpose: users live in Zitadel, not here. It is read
    -- from the session on every path and never from a request body.
    owner_sub TEXT NOT NULL,

    title TEXT,
    source_lang TEXT NOT NULL,
    portions NUMERIC,
    -- A picture of the dish, and how long it takes end to end, in minutes.
    -- Both come from a page's own metadata and are null for every other
    -- source. The ceiling is the extractor's: a month, because a cured ham is
    -- days and nothing is longer.
    image TEXT,
    total_time INT,
    ingredients JSONB NOT NULL,
    steps JSONB NOT NULL,
    -- JSONB rather than TEXT so a website import can record its URL and
    -- retrieval time and a photo import its object key.
    source JSONB,

    -- The tree this row belongs to. A root and every variant is its own; a
    -- progression inherits its parent's. It never needs rewriting, because
    -- deleting cascades along progressions and no progression outlives its
    -- ancestors.
    line_id UUID NOT NULL,
    -- Two parent columns rather than one plus a kind, because deletion
    -- cascades along progressions and stops at variants, and a single foreign
    -- key's ON DELETE applies to every child it has. Which of the two is set
    -- is the kind; a third column saying so could only ever disagree.
    progression_of UUID,
    variant_of UUID,
    -- The entry point: what the collection and every menu show. One per line,
    -- and moving it is what a new progression does.
    pinned BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (portions IS NULL OR portions > 0),
    CHECK (total_time IS NULL OR (total_time > 0 AND total_time <= 60 * 24 * 30)),
    CHECK (jsonb_typeof(ingredients) = 'array'),
    CHECK (jsonb_typeof(steps) = 'array'),
    CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
    -- A row is a progression, or a variant, or neither. Never both.
    CHECK (num_nonnulls(progression_of, variant_of) <= 1),
    CHECK (progression_of IS NULL OR progression_of <> id),
    CHECK (variant_of IS NULL OR variant_of <> id),

    -- Only so the lineage foreign keys below can carry owner_sub. Without it
    -- they have nothing to reference.
    UNIQUE (id, owner_sub),

    -- Lineage cannot cross owners: the parent is matched on its id *and* its
    -- owner, so a request naming someone else's recipe as a parent fails here
    -- rather than in whichever route forgot to check.
    FOREIGN KEY (progression_of, owner_sub) REFERENCES recipes (id, owner_sub)
        ON DELETE CASCADE,
    -- A variant outlives what it branched off — it became its own recipe —
    -- and is left pointing at nothing. The column list is what keeps this from
    -- trying to null owner_sub along with it.
    FOREIGN KEY (variant_of, owner_sub) REFERENCES recipes (id, owner_sub)
        ON DELETE SET NULL (variant_of)
);

-- The collection listing, which is always
-- WHERE owner_sub = $1 AND pinned ORDER BY created_at DESC. Partial because an
-- unpinned version is never in a listing.
CREATE INDEX recipes_owner_pinned_idx ON recipes (owner_sub, created_at DESC)
    WHERE pinned;

-- One pin per line, held here rather than by three write endpoints each
-- remembering to unpin the old one. It does not stop a line having none: that
-- half is the write path's.
CREATE UNIQUE INDEX recipes_line_pin_idx ON recipes (line_id) WHERE pinned;

-- Every version in a line, for the lineage view — an index scan rather than a
-- recursive CTE.
CREATE INDEX recipes_line_idx ON recipes (line_id);

-- Both foreign keys, so deleting a recipe does not scan the table once per
-- descendant looking for children.
CREATE INDEX recipes_progression_of_idx ON recipes (progression_of, owner_sub);
CREATE INDEX recipes_variant_of_idx ON recipes (variant_of, owner_sub);

-- updated_at has a DEFAULT, which fires only on insert; without this the
-- column would never change again.
CREATE FUNCTION recipes_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recipes_touch_updated_at
    BEFORE UPDATE ON recipes
    FOR EACH ROW EXECUTE FUNCTION recipes_touch_updated_at();

-- A root row is the first version of its own line, and its id is not known
-- until it exists. Defaulting it here means an insert can leave line_id out
-- rather than generating a UUID on the client to use twice.
CREATE FUNCTION recipes_default_line_id() RETURNS trigger AS $$
BEGIN
    IF NEW.line_id IS NULL THEN
        NEW.line_id := NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recipes_default_line_id
    BEFORE INSERT ON recipes
    FOR EACH ROW EXECUTE FUNCTION recipes_default_line_id();
