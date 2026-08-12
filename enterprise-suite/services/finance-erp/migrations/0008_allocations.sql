-- Allocation rules redistribute period cost from one (account, cost center)
-- pair across target cost centers by fixed basis-point splits.
CREATE TABLE fin_allocation_rule (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL,
    name                   TEXT NOT NULL,
    description            TEXT,
    source_account_id      TEXT NOT NULL REFERENCES fin_account (id),
    source_cost_center_id  TEXT NOT NULL REFERENCES fin_cost_center (id),
    active                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_fin_allocation_rule_tenant ON fin_allocation_rule (tenant_id);

CREATE TABLE fin_allocation_target (
    rule_id         TEXT NOT NULL REFERENCES fin_allocation_rule (id) ON DELETE CASCADE,
    cost_center_id  TEXT NOT NULL REFERENCES fin_cost_center (id),
    percent_bps     INTEGER NOT NULL CHECK (percent_bps > 0 AND percent_bps <= 10000),
    PRIMARY KEY (rule_id, cost_center_id)
);

-- Execution log: one row per rule run, linking the allocation journal.
CREATE TABLE fin_allocation_run (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    rule_id              TEXT NOT NULL REFERENCES fin_allocation_rule (id),
    period_code          TEXT NOT NULL,
    source_amount_minor  BIGINT NOT NULL,
    journal_id           TEXT REFERENCES fin_journal (id),
    skipped              BOOLEAN NOT NULL DEFAULT FALSE,
    reason               TEXT,
    executed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fin_allocation_run_tenant_period ON fin_allocation_run (tenant_id, period_code);
