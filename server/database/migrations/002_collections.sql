-- Collections: named groups of recipes a user puts together and orders by
-- hand (#46). A collection holds versions, not lines: the one that went in
-- is the one it shows, whatever the line's pin does afterwards. "The curry I
-- made at Christmas" stays that curry when a milder progression is saved.

CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- From the session, never from a request body, as on recipes.
    owner_sub TEXT NOT NULL,
    -- Trimming is the route's job; this only refuses what it forgot. The
    -- ceiling is the header dropdown's and a card's, not a storage limit.
    name TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- No surrounding whitespace, and no control characters: a name is one
    -- line.
    CHECK (name !~ '^\s|\s$' AND name !~ '[[:cntrl:]]' AND length(name) BETWEEN 1 AND 80),

    -- Only so membership can carry owner_sub in its foreign key.
    UNIQUE (id, owner_sub)
);

-- One "Weeknight" per owner, whatever its case: two of them in the picker
-- would be two rows nobody can tell apart. Also the owner's listing index.
CREATE UNIQUE INDEX collections_owner_name_idx ON collections (owner_sub, lower(name));

CREATE TRIGGER collections_touch_updated_at
    BEFORE UPDATE ON collections
    FOR EACH ROW EXECUTE FUNCTION recipes_touch_updated_at();

CREATE TABLE collection_recipes (
    collection_id UUID NOT NULL,
    recipe_id UUID NOT NULL,
    owner_sub TEXT NOT NULL,
    -- Ascending, and not necessarily contiguous: removing a recipe leaves a
    -- gap, and a reorder rewrites the whole collection from 0.
    position INT NOT NULL,

    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (position >= 0),

    -- A version is in a collection once. Two versions of one line can both
    -- be: they are different recipes to cook.
    PRIMARY KEY (collection_id, recipe_id),

    -- Two recipes cannot share a place. Deferred, because a reorder swaps
    -- positions one row at a time and only the end of the transaction has to
    -- be consistent. Its index is also the one a collection is read in order
    -- through.
    CONSTRAINT collection_recipes_position_key UNIQUE (collection_id, position)
        DEFERRABLE INITIALLY DEFERRED,

    -- Deleting a collection deletes its memberships and never a recipe.
    FOREIGN KEY (collection_id, owner_sub) REFERENCES collections (id, owner_sub)
        ON DELETE CASCADE,
    -- Only the collection owner's recipe matches: someone else's fails here
    -- rather than in whichever route forgot to check. A deleted version drops
    -- out of every collection, with no gap left behind, and so do the
    -- progressions deleting it takes along.
    FOREIGN KEY (recipe_id, owner_sub) REFERENCES recipes (id, owner_sub)
        ON DELETE CASCADE
);

-- Deleting a recipe looks for its memberships; without this that is a scan of
-- every collection.
CREATE INDEX collection_recipes_recipe_idx ON collection_recipes (recipe_id, owner_sub);
