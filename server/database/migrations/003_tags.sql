-- Tags: words a person puts on their own recipes to find them again (#13).
-- Typed, not extracted, and free text — but case-folded, so "Quick" and
-- "quick" are one tag, whichever was typed first.
--
-- A tag hangs on a line rather than a version: saving a progression, or
-- pinning an earlier one, is still the same dish, and it keeps its tags. A
-- variant is a line of its own and starts with a copy (the store's doing).

CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- From the session, never from a request body, as on recipes.
    owner_sub TEXT NOT NULL,
    -- As first typed. Trimming and collapsing inner whitespace is the route's
    -- job; this only refuses what it forgot. The ceiling is a chip's.
    name TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (name !~ '^\s|\s$|\s\s' AND name !~ '[[:cntrl:]]' AND length(name) BETWEEN 1 AND 40),

    -- Only so a line's tags can carry owner_sub in their foreign key.
    UNIQUE (id, owner_sub)
);

-- One "quick" per owner, whatever its case. Also what a write finds an
-- existing tag by, and the owner's listing index.
CREATE UNIQUE INDEX tags_owner_name_idx ON tags (owner_sub, lower(name));

CREATE TABLE recipe_tags (
    -- The line's root: the row whose id every version's line_id repeats. It
    -- exists as long as the line does, because deleting it takes the line.
    line_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    owner_sub TEXT NOT NULL,

    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (line_id, tag_id),

    -- Both matched on their owner too, so a line cannot wear someone else's
    -- tag and a tag cannot reach someone else's line. Deleting a line drops
    -- its tags; deleting a tag drops it from every line.
    FOREIGN KEY (line_id, owner_sub) REFERENCES recipes (id, owner_sub)
        ON DELETE CASCADE,
    FOREIGN KEY (tag_id, owner_sub) REFERENCES tags (id, owner_sub)
        ON DELETE CASCADE
);

-- Every line with a tag, which is what filtering by one asks, and what
-- deleting a tag looks for.
CREATE INDEX recipe_tags_tag_idx ON recipe_tags (tag_id, line_id);
