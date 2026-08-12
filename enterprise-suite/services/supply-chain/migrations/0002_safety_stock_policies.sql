-- Reusable safety stock policies referenced by planning items.

CREATE TABLE safety_stock_policy (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    description TEXT,
    -- {"type":"STATIC","qty":n} | {"type":"DAYS_OF_COVER","days":n}
    -- | {"type":"SERVICE_LEVEL","serviceLevel":0.95,"weeklyDemandStdDev":n?}
    method      JSONB       NOT NULL,
    version     INTEGER     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_ss_policy_tenant_name ON safety_stock_policy (tenant_id, name);

ALTER TABLE planning_item
    ADD CONSTRAINT fk_planning_item_ss_policy
    FOREIGN KEY (safety_stock_policy_id) REFERENCES safety_stock_policy (id)
    ON DELETE SET NULL;
