-- reporting-bi 0007: KPI definitions and snapshots
--
-- A KPI is a metric plus the context that makes it judgeable: a filter, a
-- period grain, a target and thresholds. Snapshots are stored rather than
-- recomputed on read so that the history is stable — a target changed today
-- must not silently rewrite whether last quarter was on track.

CREATE TABLE reporting.kpi_definition (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    code              reporting.snake_code NOT NULL,
    name              TEXT        NOT NULL,
    description       TEXT,
    cube_id           TEXT        NOT NULL REFERENCES reporting.cube_definition (id),
    metric_id         TEXT        NOT NULL REFERENCES reporting.metric_definition (id),
    unit              reporting.metric_unit NOT NULL,
    direction         reporting.metric_direction NOT NULL DEFAULT 'higher-is-better',
    grain             reporting.time_grain NOT NULL DEFAULT 'month',
    filters           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    target_value      NUMERIC,
    -- Attainment bands, direction-normalised so 1.0 always means "on target"
    -- whether the metric is revenue or defect rate.
    warning_threshold NUMERIC     NOT NULL DEFAULT 0.95 CHECK (warning_threshold > 0 AND warning_threshold <= 2),
    critical_threshold NUMERIC    NOT NULL DEFAULT 0.85 CHECK (critical_threshold > 0 AND critical_threshold <= 2),
    sparkline_periods INTEGER     NOT NULL DEFAULT 12 CHECK (sparkline_periods BETWEEN 2 AND 104),
    owner             TEXT,
    active            BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT kpi_code_uq UNIQUE (tenant_id, code),
    CONSTRAINT kpi_thresholds_ordered CHECK (critical_threshold < warning_threshold)
);

CREATE TRIGGER kpi_touch BEFORE UPDATE ON reporting.kpi_definition
    FOR EACH ROW EXECUTE FUNCTION reporting.touch_row();

CREATE INDEX kpi_active_ix ON reporting.kpi_definition (tenant_id, active);
CREATE INDEX kpi_cube_ix ON reporting.kpi_definition (tenant_id, cube_id);

-- One row per (KPI, period). Recomputing a period replaces it, so the
-- current period keeps moving while closed periods settle.
CREATE TABLE reporting.kpi_snapshot (
    tenant_id       TEXT        NOT NULL,
    kpi_code        reporting.snake_code NOT NULL,
    period          TEXT        NOT NULL,
    period_label    TEXT        NOT NULL,
    grain           reporting.time_grain NOT NULL,
    value           NUMERIC,
    previous_value  NUMERIC,
    target_value    NUMERIC,
    attainment      NUMERIC,
    variance        NUMERIC,
    variance_pct    NUMERIC,
    change_vs_previous NUMERIC,
    change_pct      NUMERIC,
    status          TEXT        NOT NULL CHECK (
        status IN ('on-track', 'watch', 'at-risk', 'off-track', 'no-target', 'no-data')
    ),
    trend           TEXT        NOT NULL CHECK (
        trend IN ('improving', 'worsening', 'flat', 'unknown')
    ),
    -- [{period, value}, ...] for the trailing window. Denormalised onto the
    -- snapshot so a scorecard is one row per KPI rather than one query per
    -- sparkline.
    sparkline       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kpi_code, period),
    CONSTRAINT kpi_snapshot_no_data_has_no_value CHECK (status <> 'no-data' OR value IS NULL)
);

-- History and "latest snapshot" both read this.
CREATE INDEX kpi_snapshot_history_ix
    ON reporting.kpi_snapshot (tenant_id, kpi_code, period DESC);
-- The alerting sweep: everything currently off-track.
CREATE INDEX kpi_snapshot_attention_ix
    ON reporting.kpi_snapshot (tenant_id, computed_at DESC)
    WHERE status IN ('at-risk', 'off-track');

-- Worst-first scorecard, the default "what needs attention" ordering. The
-- severity ranking matches STATUS_SEVERITY in domain/kpi.ts.
CREATE OR REPLACE VIEW reporting.kpi_scorecard AS
    SELECT DISTINCT ON (s.tenant_id, s.kpi_code)
           s.tenant_id,
           s.kpi_code,
           k.name,
           k.owner,
           s.period,
           s.value,
           s.target_value,
           s.attainment,
           s.status,
           s.trend,
           s.computed_at,
           CASE s.status
               WHEN 'off-track' THEN 0
               WHEN 'at-risk'   THEN 1
               WHEN 'watch'     THEN 2
               WHEN 'no-data'   THEN 3
               WHEN 'no-target' THEN 4
               ELSE 5
           END AS severity
      FROM reporting.kpi_snapshot s
      JOIN reporting.kpi_definition k
        ON k.tenant_id = s.tenant_id AND k.code = s.kpi_code
     ORDER BY s.tenant_id, s.kpi_code, s.period DESC;
