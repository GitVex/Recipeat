-- Matching recipe lines against the ingredient store (#172). A line's link
-- and its open question live beside the recipe, never in its JSON: linking
-- writes nothing to recipes, so it adds no version and leaves updated_at alone.
--
-- Lines are named by their id in recipes.ingredients, which is positional
-- (ingredient_1, ...), so each row also keeps the name it was made for. A row
-- whose line no longer carries that name is stale: readers join on the name,
-- and the next pass over the recipe removes it.

-- The entry a line is. Matched on the owner, as images are, so a link cannot
-- hang on someone else's recipe.
CREATE TABLE ingredient_links (
    recipe_id UUID NOT NULL,
    owner_sub TEXT NOT NULL,
    line_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ingredient_id BIGINT NOT NULL REFERENCES ingredients ON DELETE CASCADE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (recipe_id, line_id),
    FOREIGN KEY (recipe_id, owner_sub) REFERENCES recipes (id, owner_sub) ON DELETE CASCADE
);
CREATE INDEX ingredient_links_ingredient_idx ON ingredient_links (ingredient_id);

-- Close matches waiting on the owner's answer (#173), up to three a line.
-- Here only until it is answered, or the line changes or gets an exact match.
CREATE TABLE ingredient_candidates (
    recipe_id UUID NOT NULL,
    owner_sub TEXT NOT NULL,
    line_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ingredient_id BIGINT NOT NULL REFERENCES ingredients ON DELETE CASCADE,
    matched_name TEXT NOT NULL,     -- the store's name it came close to; a "typo" answer takes it
    similarity REAL NOT NULL CHECK (similarity BETWEEN 0 AND 1),
    PRIMARY KEY (recipe_id, line_id, ingredient_id),
    FOREIGN KEY (recipe_id, owner_sub) REFERENCES recipes (id, owner_sub) ON DELETE CASCADE
);
CREATE INDEX ingredient_candidates_owner_idx ON ingredient_candidates (owner_sub);

-- Recipes waiting for a pass. Workers claim one with FOR UPDATE SKIP LOCKED
-- and delete it in the transaction that matches it, so a failed pass leaves it
-- queued. not_before holds back a recipe whose pass failed, so one that keeps
-- failing doesn't stand at the front of the queue.
CREATE TABLE ingredient_queue (
    recipe_id UUID PRIMARY KEY REFERENCES recipes ON DELETE CASCADE,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    not_before TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingredient_queue_order_idx ON ingredient_queue (queued_at);

-- Every save that can change a line queues the recipe, in its own
-- transaction, so no save path can forget to. A save racing a pass over the
-- same recipe waits for the pass to finish, then queues it again. The notify
-- wakes the workers; the interval scan covers a wake-up that was missed.
CREATE FUNCTION ingredient_queue_recipe() RETURNS trigger AS $$
BEGIN
    INSERT INTO ingredient_queue (recipe_id) VALUES (NEW.id)
    ON CONFLICT (recipe_id) DO UPDATE SET not_before = now();
    PERFORM pg_notify('ingredient_queue', '');
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ingredient_queue_recipe
    AFTER INSERT OR UPDATE OF ingredients, source_lang ON recipes
    FOR EACH ROW EXECUTE FUNCTION ingredient_queue_recipe();

-- Recipes saved before matching existed.
INSERT INTO ingredient_queue (recipe_id) SELECT id FROM recipes;

-- Names a lookup found in Wikidata for an entry a cook made (#174).
ALTER TABLE ingredient_names DROP CONSTRAINT ingredient_names_source_check,
    ADD CONSTRAINT ingredient_names_source_check CHECK (source IN ('off', 'cook', 'searxng', 'wikidata'));
