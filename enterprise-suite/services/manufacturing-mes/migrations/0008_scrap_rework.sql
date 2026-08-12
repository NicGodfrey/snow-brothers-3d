-- Scrap and rework records tied to work order operations.

CREATE TABLE mes_scrap_record (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    work_order_id        TEXT NOT NULL REFERENCES mes_work_order (id),
    operation_seq        INTEGER NOT NULL CHECK (operation_seq >= 1),
    sku                  TEXT NOT NULL,
    quantity             NUMERIC(14, 6) NOT NULL CHECK (quantity > 0),
    uom                  TEXT NOT NULL,
    reason_code          TEXT NOT NULL
                         CHECK (reason_code IN ('MATERIAL_DEFECT', 'OPERATOR_ERROR',
                                                'MACHINE_FAULT', 'SETUP_LOSS', 'TOOLING_WEAR',
                                                'PROCESS_DRIFT', 'HANDLING_DAMAGE', 'OTHER')),
    disposition          TEXT NOT NULL DEFAULT 'SCRAP'
                         CHECK (disposition IN ('SCRAP', 'REWORK', 'USE_AS_IS')),
    notes                TEXT,
    reported_by          TEXT NOT NULL,
    cost_impact_minor    BIGINT,
    cost_impact_currency CHAR(3),
    rework_work_order_id TEXT REFERENCES mes_work_order (id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    version              INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_mes_scrap_rework_link
        CHECK (rework_work_order_id IS NULL OR disposition = 'REWORK'),
    CONSTRAINT ck_mes_scrap_cost_currency
        CHECK ((cost_impact_minor IS NULL) = (cost_impact_currency IS NULL))
);

CREATE INDEX ix_mes_scrap_record_wo ON mes_scrap_record (tenant_id, work_order_id);
CREATE INDEX ix_mes_scrap_record_reason ON mes_scrap_record (tenant_id, reason_code);
CREATE INDEX ix_mes_scrap_record_created ON mes_scrap_record (tenant_id, created_at);
