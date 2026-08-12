-- Work orders: execution documents with an explicit status machine.
-- Legal transitions (enforced in the domain layer):
--   DRAFT -> PLANNED | RELEASED | CANCELLED
--   PLANNED -> RELEASED | ON_HOLD | CANCELLED
--   RELEASED -> IN_PROGRESS | ON_HOLD | CANCELLED
--   IN_PROGRESS -> ON_HOLD | COMPLETED
--   ON_HOLD -> (held-from status) | CANCELLED
--   COMPLETED -> CLOSED

CREATE TABLE mes_work_order (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    order_number        TEXT NOT NULL,
    sku                 TEXT NOT NULL,
    routing_id          TEXT NOT NULL REFERENCES mes_routing (id),
    routing_revision    TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'PLANNED', 'RELEASED', 'IN_PROGRESS',
                                          'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED')),
    held_from_status    TEXT,
    hold_reason         TEXT,
    quantity_ordered    NUMERIC(14, 6) NOT NULL CHECK (quantity_ordered > 0),
    uom                 TEXT NOT NULL,
    quantity_completed  NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (quantity_completed >= 0),
    quantity_scrapped   NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (quantity_scrapped >= 0),
    quantity_received   NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    priority            SMALLINT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    due_date            DATE NOT NULL,
    demand_source_type  TEXT NOT NULL DEFAULT 'MANUAL'
                        CHECK (demand_source_type IN
                               ('SALES_ORDER', 'FORECAST', 'SAFETY_STOCK', 'REWORK', 'MANUAL')),
    demand_source_ref   TEXT,
    scheduled_start     TIMESTAMPTZ,
    scheduled_end       TIMESTAMPTZ,
    actual_start        TIMESTAMPTZ,
    actual_end          TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    cancel_reason       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    version             INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_mes_wo_received_lte_completed
        CHECK (quantity_received <= quantity_completed)
);

CREATE UNIQUE INDEX ux_mes_work_order_number ON mes_work_order (tenant_id, order_number);
CREATE INDEX ix_mes_work_order_status ON mes_work_order (tenant_id, status);
CREATE INDEX ix_mes_work_order_sku ON mes_work_order (tenant_id, sku);
CREATE INDEX ix_mes_work_order_due ON mes_work_order (tenant_id, due_date);

-- Routing snapshot + execution state per operation.
CREATE TABLE mes_work_order_operation (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL,
    work_order_id          TEXT NOT NULL REFERENCES mes_work_order (id) ON DELETE CASCADE,
    seq                    INTEGER NOT NULL CHECK (seq >= 1),
    description            TEXT NOT NULL,
    work_center_id         TEXT NOT NULL REFERENCES mes_work_center (id),
    setup_minutes          NUMERIC(10, 2) NOT NULL DEFAULT 0,
    run_minutes_per_unit   NUMERIC(10, 4) NOT NULL DEFAULT 0,
    teardown_minutes       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    queue_minutes          NUMERIC(10, 2) NOT NULL DEFAULT 0,
    move_minutes           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    inspection_required    BOOLEAN NOT NULL DEFAULT FALSE,
    crew_size              INTEGER NOT NULL DEFAULT 1,
    status                 TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'DONE')),
    qty_completed          NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (qty_completed >= 0),
    qty_scrapped           NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (qty_scrapped >= 0),
    labor_minutes_actual   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    machine_minutes_actual NUMERIC(12, 2) NOT NULL DEFAULT 0,
    scheduled_start        TIMESTAMPTZ,
    scheduled_end          TIMESTAMPTZ,
    started_at             TIMESTAMPTZ,
    finished_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX ux_mes_wo_operation_seq
    ON mes_work_order_operation (tenant_id, work_order_id, seq);
CREATE INDEX ix_mes_wo_operation_dispatch
    ON mes_work_order_operation (tenant_id, work_center_id, status);

-- Exploded BOM demand per order (requiredQty = qty * qtyPer * (1 + scrap%)).
CREATE TABLE mes_material_requirement (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    work_order_id    TEXT NOT NULL REFERENCES mes_work_order (id) ON DELETE CASCADE,
    component_sku    TEXT NOT NULL,
    qty_per_unit     NUMERIC(14, 6) NOT NULL CHECK (qty_per_unit >= 0),
    scrap_factor_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
                     CHECK (scrap_factor_pct BETWEEN 0 AND 100),
    uom              TEXT NOT NULL,
    operation_seq    INTEGER,
    unplanned        BOOLEAN NOT NULL DEFAULT FALSE,
    required_qty     NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (required_qty >= 0),
    issued_qty       NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0)
);

CREATE UNIQUE INDEX ux_mes_material_requirement_component
    ON mes_material_requirement (tenant_id, work_order_id, component_sku);
CREATE INDEX ix_mes_material_requirement_shortage
    ON mes_material_requirement (tenant_id, work_order_id)
    WHERE issued_qty < required_qty;
