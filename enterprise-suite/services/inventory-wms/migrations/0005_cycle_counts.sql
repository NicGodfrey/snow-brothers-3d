-- 0005: Cycle count orders and lines.

CREATE TABLE cycle_count_orders (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'CANCELLED')),
    scheduled_for   TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    -- Status/timestamp coherence.
    CONSTRAINT chk_cc_started CHECK (status IN ('DRAFT', 'CANCELLED') OR started_at IS NOT NULL),
    CONSTRAINT chk_cc_completed CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE INDEX idx_cc_orders_tenant_wh ON cycle_count_orders (tenant_id, warehouse_id, status);

CREATE TABLE cycle_count_lines (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    order_id        TEXT NOT NULL REFERENCES cycle_count_orders (id) ON DELETE CASCADE,
    bin_id          TEXT NOT NULL REFERENCES warehouse_bins (id),
    sku             TEXT NOT NULL,
    lot_id          TEXT REFERENCES lots (id),
    -- NULL until the order is started (baseline snapshot).
    expected_qty    INTEGER CHECK (expected_qty IS NULL OR expected_qty >= 0),
    counted_qty     INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
    variance_qty    INTEGER,
    counted_by      TEXT,
    counted_at      TIMESTAMPTZ,
    CONSTRAINT chk_ccline_variance CHECK (
        (counted_qty IS NULL AND variance_qty IS NULL)
        OR (counted_qty IS NOT NULL AND variance_qty = counted_qty - COALESCE(expected_qty, 0))
    ),
    CONSTRAINT uq_ccline_target UNIQUE (tenant_id, order_id, bin_id, sku, lot_id)
);

CREATE INDEX idx_cc_lines_order ON cycle_count_lines (tenant_id, order_id);
