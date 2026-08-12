-- reporting-bi 0004: metric definitions and their dependency graph
--
-- Two kinds of metric, and the distinction is load-bearing:
--
--   base     an aggregation over one measure field, evaluated per group
--   derived  an expression over sibling metrics, evaluated *after*
--            aggregation
--
-- Average order value is sum(revenue) / count(orders) of the period, not the
-- average of per-order ratios, and that only comes out right if derived
-- metrics run on aggregates. The CHECK constraints below keep the two kinds
-- from blurring into each other.

CREATE TABLE reporting.metric_definition (
    id           TEXT        PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    code         reporting.snake_code NOT NULL,
    name         TEXT        NOT NULL,
    description  TEXT,
    cube_id      TEXT        NOT NULL REFERENCES reporting.cube_definition (id),
    kind         TEXT        NOT NULL CHECK (kind IN ('base', 'derived')),
    unit         reporting.metric_unit NOT NULL,
    direction    reporting.metric_direction NOT NULL DEFAULT 'higher-is-better',
    status       TEXT        NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'published', 'deprecated')
    ),
    decimals     INTEGER     NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 6),
    aggregation  TEXT CHECK (
        aggregation IN ('sum', 'avg', 'min', 'max', 'count', 'count_distinct', 'first', 'last')
    ),
    source_field reporting.snake_code,
    expression   TEXT,
    tags         TEXT[]      NOT NULL DEFAULT '{}',
    deprecation_reason TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT metric_code_uq UNIQUE (tenant_id, code),
    CONSTRAINT metric_base_shape CHECK (
        kind <> 'base' OR (aggregation IS NOT NULL AND expression IS NULL)
    ),
    CONSTRAINT metric_derived_shape CHECK (
        kind <> 'derived' OR (expression IS NOT NULL AND aggregation IS NULL AND source_field IS NULL)
    ),
    -- count() folds whole rows; everything else needs a field to fold.
    CONSTRAINT metric_source_field_required CHECK (
        kind <> 'base'
        OR (aggregation = 'count' AND source_field IS NULL)
        OR (aggregation <> 'count' AND source_field IS NOT NULL)
    ),
    CONSTRAINT metric_deprecated_has_reason CHECK (
        status <> 'deprecated' OR deprecation_reason IS NOT NULL
    )
);

CREATE TRIGGER metric_touch BEFORE UPDATE ON reporting.metric_definition
    FOR EACH ROW EXECUTE FUNCTION reporting.touch_row();

CREATE INDEX metric_cube_ix ON reporting.metric_definition (tenant_id, cube_id);
CREATE INDEX metric_status_ix ON reporting.metric_definition (tenant_id, status);
CREATE INDEX metric_tags_ix ON reporting.metric_definition USING gin (tags);

-- Materialised edges of the dependency graph, extracted from the expression
-- when a derived metric is saved. Storing them makes lineage a join instead
-- of a parse, and lets the database refuse to delete a metric something else
-- still reads.
CREATE TABLE reporting.metric_dependency (
    tenant_id     TEXT NOT NULL,
    metric_id     TEXT NOT NULL REFERENCES reporting.metric_definition (id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES reporting.metric_definition (id) ON DELETE RESTRICT,
    PRIMARY KEY (metric_id, depends_on_id),
    CONSTRAINT metric_dependency_not_self CHECK (metric_id <> depends_on_id)
);

CREATE INDEX metric_dependency_reverse_ix
    ON reporting.metric_dependency (depends_on_id);

-- A derived metric may only read metrics of its own cube: the aggregation
-- engine evaluates expressions inside one group of one fact table, so a
-- cross-cube reference has no value to read.
CREATE OR REPLACE FUNCTION reporting.assert_dependency_same_cube()
RETURNS TRIGGER AS $$
DECLARE
    metric_cube TEXT;
    target_cube TEXT;
BEGIN
    SELECT cube_id INTO metric_cube FROM reporting.metric_definition WHERE id = NEW.metric_id;
    SELECT cube_id INTO target_cube FROM reporting.metric_definition WHERE id = NEW.depends_on_id;
    IF metric_cube IS DISTINCT FROM target_cube THEN
        RAISE EXCEPTION 'metric % cannot depend on % from another cube', NEW.metric_id, NEW.depends_on_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metric_dependency_same_cube
    BEFORE INSERT OR UPDATE ON reporting.metric_dependency
    FOR EACH ROW EXECUTE FUNCTION reporting.assert_dependency_same_cube();

-- Transitive closure, used to reject cycles before a metric is published and
-- to answer "what breaks if I deprecate this?".
CREATE OR REPLACE VIEW reporting.metric_lineage AS
    WITH RECURSIVE closure AS (
        SELECT metric_id, depends_on_id, 1 AS distance
          FROM reporting.metric_dependency
        UNION
        SELECT c.metric_id, d.depends_on_id, c.distance + 1
          FROM closure c
          JOIN reporting.metric_dependency d ON d.metric_id = c.depends_on_id
         WHERE c.distance < 16
    )
    SELECT m.tenant_id,
           m.code            AS metric_code,
           target.code       AS depends_on_code,
           closure.distance
      FROM closure
      JOIN reporting.metric_definition m      ON m.id = closure.metric_id
      JOIN reporting.metric_definition target ON target.id = closure.depends_on_id;
