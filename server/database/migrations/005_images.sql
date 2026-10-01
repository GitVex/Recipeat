-- Images (#45): photos a person took of a dish, and the page a photo import
-- was read from. Kept in Postgres as bytes rather than in an object store, so
-- there is no second service to run, back up or keep in step with this one,
-- and an image is deleted by the same foreign keys as what it belongs to.
-- What leaves only through GET /api/images/{id}, so moving the bytes elsewhere
-- later changes that route and nothing that links to it.
--
-- A dish photo hangs on a version, not a line: each version is another go at
-- the dish, and its photos are of that one. A new progression starts with
-- none. The source photo hangs on the line's root, which lives as long as the
-- line does, so every version of the line finds it through line_id.
--
-- Both sizes are derivatives the browser made: about 1600 px on the long edge
-- for the recipe page, about 400 px for a card. Nothing here decodes them.

CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL,
    owner_sub TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('dish', 'source')),
    -- Dish photos only, in the order shown. 0 to 9 and unique per version is
    -- the limit of ten, held here rather than counted by a route.
    position SMALLINT CHECK (position BETWEEN 0 AND 9),
    cover BOOLEAN NOT NULL DEFAULT false,
    -- Read from the bytes on upload; what the browser claimed is not kept.
    media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/webp')),
    data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1500000),
    thumb BYTEA NOT NULL CHECK (octet_length(thumb) BETWEEN 1 AND 150000),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK ((kind = 'dish') = (position IS NOT NULL)),
    CHECK (NOT cover OR kind = 'dish'),

    -- Deferred, as collection positions are, so a reorder can rewrite them in
    -- any order inside one transaction.
    UNIQUE (recipe_id, position) DEFERRABLE INITIALLY DEFERRED,

    -- Matched on the owner, so an image cannot hang on someone else's recipe.
    -- Deleting a version deletes its images, and a deletion that takes later
    -- progressions takes theirs.
    FOREIGN KEY (recipe_id, owner_sub) REFERENCES recipes (id, owner_sub)
        ON DELETE CASCADE
);

-- JPEG and WebP are compressed already; TOAST would only try and give up.
ALTER TABLE images
    ALTER COLUMN data SET STORAGE EXTERNAL,
    ALTER COLUMN thumb SET STORAGE EXTERNAL;

-- One cover per version, and one source photo per line (on its root). The
-- first is also what a card looks for.
CREATE UNIQUE INDEX images_cover_idx ON images (recipe_id) WHERE cover;
CREATE UNIQUE INDEX images_source_idx ON images (recipe_id) WHERE kind = 'source';
