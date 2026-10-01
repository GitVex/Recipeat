-- Preferences (#62): how a person reads recipes, kept with the account rather
-- than in one browser's cookies. One row per person, made on their first save;
-- no row reads as every preference unset.
--
-- One document rather than a column each: which preferences there are, and
-- what each may hold, is PREFERENCES in shared/utils/preferences.ts, and the
-- route checks a save against it. Adding one is a line there, not a migration.

CREATE TABLE preferences (
    -- From the session, never from a request body, as on recipes.
    owner_sub TEXT PRIMARY KEY,
    -- { "<key>": value | null, … }. A key the config no longer has is ignored
    -- on reading and dropped on the next save.
    settings JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
