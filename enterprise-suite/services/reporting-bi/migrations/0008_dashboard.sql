-- reporting-bi 0008: dashboards and tiles
--
-- Tiles store *relative* windows ("trailing 12 months"), never absolute
-- dates: a dashboard saved in January must still be right in June without
-- anyone editing it. The absolute range is resolved at render time.

CREATE TABLE reporting.dashboard (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    code                     reporting.kebab_code NOT NULL,
    title                    TEXT        NOT NULL,
    description              TEXT,
    status                   TEXT        NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'published', 'archived')
    ),
    -- Empty means "any authenticated user of the tenant".
    audience_roles           TEXT[]      NOT NULL DEFAULT '{}',
    refresh_interval_seconds INTEGER     NOT NULL DEFAULT 300 CHECK (
        refresh_interval_seconds BETWEEN 30 AND 86400
    ),
    archive_reason           TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                  INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT dashboard_code_uq UNIQUE (tenant_id, code),
    CONSTRAINT dashboard_archived_has_reason CHECK (
        status <> 'archived' OR archive_reason IS NOT NULL
    )
);

CREATE TRIGGER dashboard_touch BEFORE UPDATE ON reporting.dashboard
    FOR EACH ROW EXECUTE FUNCTION reporting.touch_row();

CREATE INDEX dashboard_status_ix ON reporting.dashboard (tenant_id, status);
CREATE INDEX dashboard_audience_ix ON reporting.dashboard USING gin (audience_roles);

CREATE TABLE reporting.dashboard_tile (
    id            TEXT    PRIMARY KEY,
    dashboard_id  TEXT    NOT NULL REFERENCES reporting.dashboard (id) ON DELETE CASCADE,
    tenant_id     TEXT    NOT NULL,
    type          TEXT    NOT NULL CHECK (type IN ('kpi', 'chart', 'table')),
    title         TEXT    NOT NULL,
    -- 12-column grid, matching GRID_COLUMNS in domain/dashboard.ts.
    grid_row      INTEGER NOT NULL CHECK (grid_row >= 0),
    grid_col      INTEGER NOT NULL CHECK (grid_col >= 0),
    grid_width    INTEGER NOT NULL CHECK (grid_width BETWEEN 1 AND 12),
    grid_height   INTEGER NOT NULL CHECK (grid_height BETWEEN 1 AND 12),
    window_grain  reporting.time_grain NOT NULL DEFAULT 'month',
    window_trailing_periods INTEGER NOT NULL DEFAULT 12 CHECK (
        window_trailing_periods BETWEEN 1 AND 400
    ),
    -- FALSE when the grain is only a window length (a donut of the last
    -- quarter) rather than a grouping key (a line chart by month).
    window_group_by_period BOOLEAN NOT NULL DEFAULT TRUE,
    kpi_code      reporting.snake_code,
    chart_kind    TEXT CHECK (
        chart_kind IN ('line', 'area', 'bar', 'stacked-bar', 'pie', 'donut')
    ),
    -- The stored query, without a time range; the window supplies that.
    query         JSONB,
    position      INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT tile_fits_grid CHECK (grid_col + grid_width <= 12),
    CONSTRAINT tile_kpi_has_code CHECK (type <> 'kpi' OR kpi_code IS NOT NULL),
    CONSTRAINT tile_data_has_query CHECK (type = 'kpi' OR query IS NOT NULL),
    CONSTRAINT tile_chart_has_kind CHECK (type <> 'chart' OR chart_kind IS NOT NULL),
    -- Two tiles of one dashboard may not occupy the same cell. Expressed as
    -- a geometric exclusion because the alternative — a read-modify-write
    -- overlap check in the application — races under concurrent editing.
    CONSTRAINT tile_no_overlap EXCLUDE USING gist (
        dashboard_id WITH =,
        box(
            point(grid_col, grid_row),
            point(grid_col + grid_width, grid_row + grid_height)
        ) WITH &&
    )
);

CREATE INDEX dashboard_tile_dashboard_ix
    ON reporting.dashboard_tile (dashboard_id, position);
CREATE INDEX dashboard_tile_kpi_ix
    ON reporting.dashboard_tile (tenant_id, kpi_code)
    WHERE kpi_code IS NOT NULL;

-- Which cubes a dashboard reads, for impact analysis before archiving one.
CREATE OR REPLACE VIEW reporting.dashboard_cube_usage AS
    SELECT d.tenant_id,
           d.code AS dashboard_code,
           coalesce(t.query ->> 'cube', k.cube_id) AS cube_ref,
           count(*) AS tile_count
      FROM reporting.dashboard d
      JOIN reporting.dashboard_tile t ON t.dashboard_id = d.id
      LEFT JOIN reporting.kpi_definition k
             ON k.tenant_id = d.tenant_id AND k.code = t.kpi_code
     GROUP BY d.tenant_id, d.code, coalesce(t.query ->> 'cube', k.cube_id);
