-- Posting periods gate what the GL accepts. Period 13 is the year-end
-- adjustment period and may overlap period 12's dates.
CREATE TABLE fin_posting_period (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    code         TEXT NOT NULL,             -- "YYYY-PP"
    fiscal_year  INTEGER NOT NULL,
    period_no    INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED')),
    closed_at    TIMESTAMPTZ,
    closed_by    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_period_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT ck_fin_period_dates CHECK (start_date <= end_date)
);

CREATE INDEX idx_fin_period_tenant_year ON fin_posting_period (tenant_id, fiscal_year);
CREATE INDEX idx_fin_period_tenant_dates ON fin_posting_period (tenant_id, start_date, end_date);

-- Close-run checklist tracking (workflow state for month-end close).
CREATE TABLE fin_period_close_run (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    period_code   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                  CHECK (status IN ('IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED')),
    started_by    TEXT NOT NULL,
    completed_at  TIMESTAMPTZ,
    completed_by  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_fin_close_run_tenant_period ON fin_period_close_run (tenant_id, period_code);

CREATE TABLE fin_period_close_check (
    run_id        TEXT NOT NULL REFERENCES fin_period_close_run (id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PASSED', 'FAILED')),
    detail        TEXT,
    evaluated_at  TIMESTAMPTZ,
    PRIMARY KEY (run_id, code)
);
