-- SRM core: KPI catalog and periodic supplier scorecards.

CREATE TABLE srm_kpi_definitions (
    id           TEXT         PRIMARY KEY,
    tenant_id    TEXT         NOT NULL,
    code         TEXT         NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
    name         TEXT         NOT NULL,
    description  TEXT,
    category     TEXT         NOT NULL CHECK (category IN (
        'quality', 'delivery', 'cost', 'service', 'innovation', 'esg', 'compliance')),
    unit         TEXT         NOT NULL CHECK (unit IN (
        'percent', 'ppm', 'days', 'hours', 'count', 'currency', 'score', 'ratio')),
    direction    TEXT         NOT NULL CHECK (direction IN ('higher_better', 'lower_better')),
    -- Value scoring 100; `floor` is the value scoring 0. Which one is larger
    -- depends on the direction, so the pair is checked against it.
    target       NUMERIC(14,4) NOT NULL,
    floor        NUMERIC(14,4) NOT NULL,
    weight       NUMERIC(5,2)  NOT NULL CHECK (weight > 0 AND weight <= 100),
    mandatory    BOOLEAN      NOT NULL DEFAULT FALSE,
    source       TEXT         NOT NULL DEFAULT 'manual'
        CHECK (source IN ('system', 'manual', 'survey', 'supplier_reported')),
    green_score  SMALLINT     NOT NULL DEFAULT 85 CHECK (green_score BETWEEN 1 AND 100),
    amber_score  SMALLINT     NOT NULL DEFAULT 70 CHECK (amber_score BETWEEN 0 AND 99),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL,
    UNIQUE (tenant_id, code),
    CHECK (amber_score < green_score),
    CHECK ((direction = 'higher_better' AND target > floor)
        OR (direction = 'lower_better' AND target < floor))
);

CREATE TABLE srm_scorecards (
    id                TEXT         PRIMARY KEY,
    tenant_id         TEXT         NOT NULL,
    supplier_id       TEXT         NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    supplier_code     TEXT         NOT NULL,
    -- Sortable period code: 2026-03 (month), 2026-Q1 (quarter), 2026 (year).
    period_code       TEXT         NOT NULL CHECK (period_code ~ '^[0-9]{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$'),
    period_kind       TEXT         NOT NULL CHECK (period_kind IN ('month', 'quarter', 'year')),
    period_start      DATE         NOT NULL,
    period_end        DATE         NOT NULL,
    status            TEXT         NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'in_review', 'published', 'disputed', 'closed')),
    score             NUMERIC(5,2) CHECK (score BETWEEN 0 AND 100),
    rating            TEXT CHECK (rating IN ('excellent', 'good', 'acceptable', 'watch', 'probation')),
    previous_score    NUMERIC(5,2),
    published_at      TIMESTAMPTZ,
    published_by      TEXT,
    published_on      DATE,
    -- Window in which the supplier may still dispute the published result.
    dispute_due_on    DATE,
    review_note       TEXT,
    closed_at         TIMESTAMPTZ,
    version           INTEGER      NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ  NOT NULL,
    updated_at        TIMESTAMPTZ  NOT NULL,
    -- One scorecard per supplier per period.
    UNIQUE (supplier_id, period_code),
    CHECK (period_end >= period_start),
    CHECK (status NOT IN ('published', 'disputed', 'closed')
        OR (score IS NOT NULL AND rating IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX srm_scorecards_period_idx ON srm_scorecards (tenant_id, period_code, status);
CREATE INDEX srm_scorecards_rating_idx ON srm_scorecards (tenant_id, rating);

-- Weight, target and band are snapshotted from the definition at measurement
-- time, so re-tuning a KPI later cannot rewrite a published period.
CREATE TABLE srm_scorecard_measurements (
    scorecard_id  TEXT          NOT NULL REFERENCES srm_scorecards (id) ON DELETE CASCADE,
    tenant_id     TEXT          NOT NULL,
    kpi_code      TEXT          NOT NULL,
    kpi_name      TEXT          NOT NULL,
    value         NUMERIC(14,4) NOT NULL,
    score         NUMERIC(5,2)  NOT NULL CHECK (score BETWEEN 0 AND 100),
    band          TEXT          NOT NULL CHECK (band IN ('green', 'amber', 'red')),
    weight        NUMERIC(5,2)  NOT NULL CHECK (weight > 0),
    target        NUMERIC(14,4) NOT NULL,
    unit          TEXT          NOT NULL,
    mandatory     BOOLEAN       NOT NULL DEFAULT FALSE,
    source        TEXT          NOT NULL,
    note          TEXT,
    recorded_by   TEXT          NOT NULL,
    recorded_at   TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (scorecard_id, kpi_code)
);

-- Corrections applied while resolving a dispute; the original value stays on
-- the measurement row, so the audit trail survives.
CREATE TABLE srm_scorecard_adjustments (
    scorecard_id    TEXT          NOT NULL,
    tenant_id       TEXT          NOT NULL,
    kpi_code        TEXT          NOT NULL,
    sequence        SMALLINT      NOT NULL,
    previous_value  NUMERIC(14,4) NOT NULL,
    previous_score  NUMERIC(5,2)  NOT NULL,
    new_value       NUMERIC(14,4) NOT NULL,
    new_score       NUMERIC(5,2)  NOT NULL,
    reason          TEXT          NOT NULL,
    adjusted_by     TEXT          NOT NULL,
    adjusted_at     TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (scorecard_id, kpi_code, sequence),
    FOREIGN KEY (scorecard_id, kpi_code)
        REFERENCES srm_scorecard_measurements (scorecard_id, kpi_code) ON DELETE CASCADE
);

CREATE TABLE srm_scorecard_disputes (
    scorecard_id  TEXT        PRIMARY KEY REFERENCES srm_scorecards (id) ON DELETE CASCADE,
    tenant_id     TEXT        NOT NULL,
    reason        TEXT        NOT NULL,
    raised_by     TEXT        NOT NULL,
    raised_at     TIMESTAMPTZ NOT NULL,
    resolution    TEXT,
    resolved_by   TEXT,
    resolved_at   TIMESTAMPTZ,
    CHECK ((resolution IS NULL) = (resolved_at IS NULL))
);

CREATE TABLE srm_scorecard_actions (
    id            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    scorecard_id  TEXT        NOT NULL REFERENCES srm_scorecards (id) ON DELETE CASCADE,
    title         TEXT        NOT NULL,
    kpi_code      TEXT,
    owner_id      TEXT        NOT NULL,
    due_on        DATE        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    outcome       TEXT,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL,
    CHECK (status <> 'completed' OR (outcome IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX srm_scorecard_actions_open_idx
    ON srm_scorecard_actions (tenant_id, due_on)
    WHERE status IN ('open', 'in_progress');
