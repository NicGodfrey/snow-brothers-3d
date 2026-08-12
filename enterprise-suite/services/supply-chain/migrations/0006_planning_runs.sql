-- Planning runs and their append-only audit trail.

CREATE TABLE planning_run (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    name           TEXT        NOT NULL,
    location       TEXT        NOT NULL,
    horizon_weeks  INTEGER     NOT NULL CHECK (horizon_weeks BETWEEN 1 AND 104),
    -- {"type":"ALL_ITEMS"} | {"type":"ITEMS","skus":[...]}
    scope          JSONB       NOT NULL DEFAULT '{"type":"ALL_ITEMS"}',
    status         TEXT        NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED')),
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    failure_reason TEXT,
    -- {"itemsPlanned":n,"ordersCreated":n,"exceptionCount":n,
    --  "levelsProcessed":n,"elapsedMs":n}
    stats          JSONB,
    version        INTEGER     NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_planning_run_tenant ON planning_run (tenant_id, created_at DESC);

CREATE TABLE planning_run_audit (
    run_id  TEXT        NOT NULL REFERENCES planning_run (id) ON DELETE CASCADE,
    seq     INTEGER     NOT NULL,
    at      TIMESTAMPTZ NOT NULL,
    level   TEXT        NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
    message TEXT        NOT NULL,
    context JSONB,
    PRIMARY KEY (run_id, seq)
);
