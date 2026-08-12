-- Per-tenant lead scoring configuration.
CREATE TABLE IF NOT EXISTS mkt_scoring_models (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    name           TEXT NOT NULL,
    half_life_days NUMERIC(6, 2) NOT NULL CHECK (half_life_days > 0),
    mql_threshold  INTEGER NOT NULL CHECK (mql_threshold BETWEEN 0 AND 100),
    sql_threshold  INTEGER NOT NULL CHECK (sql_threshold BETWEEN 0 AND 100),
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_mkt_scoring_thresholds CHECK (mql_threshold < sql_threshold)
);

-- Exactly one default model per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_scoring_default
    ON mkt_scoring_models (tenant_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS mkt_scoring_activity_weights (
    model_id TEXT NOT NULL REFERENCES mkt_scoring_models (id) ON DELETE CASCADE,
    activity TEXT NOT NULL,
    points   INTEGER NOT NULL CHECK (points >= 0),
    PRIMARY KEY (model_id, activity)
);

CREATE TABLE IF NOT EXISTS mkt_scoring_demographic_rules (
    id       BIGSERIAL PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES mkt_scoring_models (id) ON DELETE CASCADE,
    field    TEXT NOT NULL CHECK (field IN ('industry', 'country', 'jobTitle', 'companySize', 'source')),
    op       TEXT NOT NULL CHECK (op IN ('eq', 'in', 'contains', 'gte', 'lte')),
    value    JSONB NOT NULL,
    points   INTEGER NOT NULL
);
