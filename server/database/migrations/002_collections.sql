-- Collections: named groups of recipes a user puts together and orders by
-- hand (#46). A collection holds lines, not versions: it shows whatever each
-- line has pinned, so saving a progression does not leave it pointing at the
-- old one.

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

-- A line is named by its root's id: the root's line_id is its own id, and a
-- line only ends when its root is deleted. Deleting a progression leaves the
-- line alive, with the pin moved back. The membership foreign key is on
-- (id, line_id, owner_sub), which only a root row can match with line_id
-- twice, and which this makes referenceable.
ALTER TABLE recipes ADD CONSTRAINT recipes_id_line_owner_key UNIQUE (id, line_id, owner_sub);

CREATE TABLE collection_recipes (
    collection_id UUID NOT NULL,
    line_id UUID NOT NULL,
    owner_sub TEXT NOT NULL,
    -- Ascending, and not necessarily contiguous: removing a recipe leaves a
    -- gap, and a reorder rewrites the whole collection from 0.
    position INT NOT NULL,

    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (position >= 0),

    -- A line is in a collection once.
    PRIMARY KEY (collection_id, line_id),

    -- Two recipes cannot share a place. Deferred, because a reorder swaps
    -- positions one row at a time and only the end of the transaction has to
    -- be consistent. Its index is also the one a collection is read in order
    -- through.
    CONSTRAINT collection_recipes_position_key UNIQUE (collection_id, position)
        DEFERRABLE INITIALLY DEFERRED,

    -- Deleting a collection deletes its memberships and never a recipe.
    FOREIGN KEY (collection_id, owner_sub) REFERENCES collections (id, owner_sub)
        ON DELETE CASCADE,
    -- Only a line's root matches, and only the collection owner's: a
    -- progression's id, or someone else's recipe, fails here rather than in
    -- whichever route forgot to check. Deleting the root ends the line and
    -- takes it out of every collection, with no gap left behind.
    FOREIGN KEY (line_id, line_id, owner_sub) REFERENCES recipes (id, line_id, owner_sub)
        ON DELETE CASCADE
);

-- Deleting a recipe looks for memberships of its line; without this that is
-- a scan of every collection.
CREATE INDEX collection_recipes_line_idx ON collection_recipes (line_id, owner_sub);
