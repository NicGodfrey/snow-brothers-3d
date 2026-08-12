-- reporting-bi 0003: cube definitions
--
-- A cube is the schema of a fact table: which dimension keys its facts carry,
-- which numeric measures they may hold, and which upstream event types feed
-- it. It is the contract between ingest and query — ingest cannot invent a
-- column the cube never declared, and a query cannot group by one.

CREATE TABLE reporting.cube_definition (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    name            reporting.cube_name NOT NULL,
    title           TEXT        NOT NULL,
    description     TEXT,
    status          TEXT        NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'published', 'archived')
    ),
    default_grain   reporting.time_grain NOT NULL DEFAULT 'day',
    default_metrics TEXT[]      NOT NULL DEFAULT '{}',
    -- 0 keeps facts forever; anything else is enforced by the retention job.
    retention_days  INTEGER     NOT NULL DEFAULT 0 CHECK (retention_days >= 0),
    archive_reason  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT cube_name_uq UNIQUE (tenant_id, name),
    CONSTRAINT cube_archived_has_reason CHECK (status <> 'archived' OR archive_reason IS NOT NULL)
);

CREATE TRIGGER cube_touch BEFORE UPDATE ON reporting.cube_definition
    FOR EACH ROW EXECUTE FUNCTION reporting.touch_row();

-- Binds a fact column to a dimension. fact_key is the key inside
-- fact_record.dimensions; dimension_id is what it resolves against, which is
-- how `material` on the quality cube can roll up through the product
-- hierarchy without renaming the column.
CREATE TABLE reporting.cube_dimension (
    cube_id      TEXT    NOT NULL REFERENCES reporting.cube_definition (id) ON DELETE CASCADE,
    fact_key     reporting.snake_code NOT NULL,
    dimension_id TEXT    NOT NULL REFERENCES reporting.dimension (id),
    label        TEXT    NOT NULL,
    required     BOOLEAN NOT NULL DEFAULT FALSE,
    position     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (cube_id, fact_key)
);

CREATE INDEX cube_dimension_dimension_ix ON reporting.cube_dimension (dimension_id);

CREATE TABLE reporting.cube_measure_field (
    cube_id     TEXT    NOT NULL REFERENCES reporting.cube_definition (id) ON DELETE CASCADE,
    field       reporting.snake_code NOT NULL,
    label       TEXT    NOT NULL,
    -- Money measures are integer minor units end to end; the flag tells
    -- formatting where the implied decimal point goes.
    is_currency BOOLEAN NOT NULL DEFAULT FALSE,
    position    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (cube_id, field)
);

-- Which event types feed this cube. Denormalised from the mapping registry
-- so the catalog can answer "where do these numbers come from?" without the
-- application being up.
CREATE TABLE reporting.cube_source_event (
    cube_id    TEXT NOT NULL REFERENCES reporting.cube_definition (id) ON DELETE CASCADE,
    event_type reporting.event_type NOT NULL,
    PRIMARY KEY (cube_id, event_type)
);

CREATE INDEX cube_source_event_type_ix ON reporting.cube_source_event (event_type);

-- A published cube needs at least one measure, otherwise every metric on it
-- is unsatisfiable. Deferred so the initial INSERT ... then add measures
-- sequence inside one transaction still works.
CREATE OR REPLACE FUNCTION reporting.assert_cube_publishable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'published'
       AND NOT EXISTS (SELECT 1 FROM reporting.cube_measure_field WHERE cube_id = NEW.id)
    THEN
        RAISE EXCEPTION 'cube % cannot be published without a measure field', NEW.name;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER cube_publishable
    AFTER INSERT OR UPDATE ON reporting.cube_definition
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION reporting.assert_cube_publishable();
