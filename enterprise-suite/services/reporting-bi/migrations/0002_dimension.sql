-- reporting-bi 0002: dimensions, hierarchy levels and members
--
-- Facts store leaf keys only (a SKU, a site code). Grouping by a higher
-- level is a walk up the member's parent chain, so the hierarchy has to be
-- correct by construction: a member's parent must sit exactly one level
-- above it, which is checked by trigger below rather than left to the
-- application.

CREATE TABLE reporting.dimension (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    key         reporting.snake_code NOT NULL,
    label       TEXT        NOT NULL,
    description TEXT,
    type        TEXT        NOT NULL DEFAULT 'categorical' CHECK (
        type IN ('categorical', 'entity', 'geo', 'time', 'flag')
    ),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT dimension_key_uq UNIQUE (tenant_id, key)
);

CREATE TRIGGER dimension_touch BEFORE UPDATE ON reporting.dimension
    FOR EACH ROW EXECUTE FUNCTION reporting.touch_row();

-- Levels are ordered top-down; depth 0 is the root and the deepest level is
-- the fact grain. Depth is explicit rather than derived from insertion order
-- because roll-up correctness depends on it.
CREATE TABLE reporting.dimension_level (
    dimension_id TEXT    NOT NULL REFERENCES reporting.dimension (id) ON DELETE CASCADE,
    key          reporting.snake_code NOT NULL,
    label        TEXT    NOT NULL,
    depth        INTEGER NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (dimension_id, key),
    CONSTRAINT dimension_level_depth_uq UNIQUE (dimension_id, depth)
);

-- Slowly-changing type 1: a re-registered member replaces its label and
-- parent. Type 2 would add (valid_from, valid_to) here and to the fact join;
-- the surrounding shape is deliberately left able to take that.
CREATE TABLE reporting.dimension_member (
    tenant_id    TEXT    NOT NULL,
    dimension_id TEXT    NOT NULL REFERENCES reporting.dimension (id) ON DELETE CASCADE,
    key          TEXT    NOT NULL,
    label        TEXT    NOT NULL,
    level_key    reporting.snake_code NOT NULL,
    parent_key   TEXT,
    attributes   JSONB   NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (dimension_id, key),
    CONSTRAINT dimension_member_level_fk
        FOREIGN KEY (dimension_id, level_key) REFERENCES reporting.dimension_level (dimension_id, key),
    CONSTRAINT dimension_member_parent_fk
        FOREIGN KEY (dimension_id, parent_key) REFERENCES reporting.dimension_member (dimension_id, key)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT dimension_member_no_self_parent CHECK (parent_key IS DISTINCT FROM key)
);

CREATE INDEX dimension_member_level_ix
    ON reporting.dimension_member (dimension_id, level_key);
CREATE INDEX dimension_member_parent_ix
    ON reporting.dimension_member (dimension_id, parent_key)
    WHERE parent_key IS NOT NULL;
CREATE INDEX dimension_member_tenant_ix
    ON reporting.dimension_member (tenant_id, dimension_id);

-- A parent must be exactly one level up, and only a root-level member may
-- have no parent. Enforced here because a broken chain does not fail loudly:
-- it silently drops rows into an "(unmapped)" bucket at query time.
CREATE OR REPLACE FUNCTION reporting.assert_member_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
    member_depth INTEGER;
    parent_depth INTEGER;
BEGIN
    SELECT depth INTO member_depth
      FROM reporting.dimension_level
     WHERE dimension_id = NEW.dimension_id AND key = NEW.level_key;

    IF NEW.parent_key IS NULL THEN
        IF member_depth <> 0 THEN
            RAISE EXCEPTION 'member %.% is at depth % and requires a parent',
                NEW.dimension_id, NEW.key, member_depth;
        END IF;
        RETURN NEW;
    END IF;

    SELECT l.depth INTO parent_depth
      FROM reporting.dimension_member m
      JOIN reporting.dimension_level l
        ON l.dimension_id = m.dimension_id AND l.key = m.level_key
     WHERE m.dimension_id = NEW.dimension_id AND m.key = NEW.parent_key;

    IF parent_depth IS NULL THEN
        RAISE EXCEPTION 'parent member %.% does not exist', NEW.dimension_id, NEW.parent_key;
    END IF;
    IF parent_depth <> member_depth - 1 THEN
        RAISE EXCEPTION 'parent %.% is at depth %, expected % for child %',
            NEW.dimension_id, NEW.parent_key, parent_depth, member_depth - 1, NEW.key;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER dimension_member_hierarchy
    AFTER INSERT OR UPDATE ON reporting.dimension_member
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION reporting.assert_member_hierarchy();

-- Roll-up used by grouped queries: the ancestor of `member_key` at
-- `target_level`, or NULL when the chain is incomplete. The recursion is
-- bounded by the number of levels, so a corrupted parent cycle in restored
-- data cannot spin.
CREATE OR REPLACE FUNCTION reporting.roll_up(
    p_dimension_id TEXT,
    p_member_key   TEXT,
    p_target_level TEXT
) RETURNS TEXT AS $$
    WITH RECURSIVE chain AS (
        SELECT m.key, m.parent_key, m.level_key, 0 AS hops
          FROM reporting.dimension_member m
         WHERE m.dimension_id = p_dimension_id AND m.key = p_member_key
        UNION ALL
        SELECT parent.key, parent.parent_key, parent.level_key, chain.hops + 1
          FROM chain
          JOIN reporting.dimension_member parent
            ON parent.dimension_id = p_dimension_id AND parent.key = chain.parent_key
         WHERE chain.hops < 16
    )
    SELECT key FROM chain WHERE level_key = p_target_level LIMIT 1;
$$ LANGUAGE sql STABLE;
