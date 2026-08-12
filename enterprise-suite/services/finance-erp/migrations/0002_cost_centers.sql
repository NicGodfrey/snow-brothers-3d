-- Cost centers form an optional analytic dimension on journal lines and
-- subledger document lines.
CREATE TABLE fin_cost_center (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    code              TEXT NOT NULL,
    name              TEXT NOT NULL,
    parent_code       TEXT,
    manager_user_id   TEXT,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_cost_center_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_fin_cost_center_tenant ON fin_cost_center (tenant_id);
