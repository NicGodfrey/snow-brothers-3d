-- 0004: Sales-order reservations and their stock allocations.

CREATE TABLE reservations (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    sales_order_id  TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'PARTIALLY_ALLOCATED', 'ALLOCATED',
                                      'RELEASED', 'FULFILLED', 'CANCELLED')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_reservations_tenant_so ON reservations (tenant_id, sales_order_id);
CREATE INDEX idx_reservations_tenant_wh ON reservations (tenant_id, warehouse_id, status);
-- One *active* reservation per sales order; closed ones are kept for audit.
CREATE UNIQUE INDEX uq_reservations_active_so ON reservations (tenant_id, sales_order_id)
    WHERE status IN ('OPEN', 'PARTIALLY_ALLOCATED', 'ALLOCATED');

CREATE TABLE reservation_lines (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    reservation_id  TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    uom             TEXT NOT NULL DEFAULT 'EA',
    requested_qty   INTEGER NOT NULL CHECK (requested_qty > 0),
    allocated_qty   INTEGER NOT NULL DEFAULT 0 CHECK (allocated_qty >= 0),
    fulfilled_qty   INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_qty >= 0),
    CONSTRAINT chk_resline_alloc_lte_requested CHECK (allocated_qty <= requested_qty),
    CONSTRAINT uq_resline_sku UNIQUE (tenant_id, reservation_id, sku)
);

CREATE INDEX idx_reslines_reservation ON reservation_lines (tenant_id, reservation_id);

CREATE TABLE reservation_allocations (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    reservation_id  TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
    line_id         TEXT NOT NULL REFERENCES reservation_lines (id) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    bin_id          TEXT NOT NULL REFERENCES warehouse_bins (id),
    lot_id          TEXT REFERENCES lots (id),
    qty             INTEGER NOT NULL CHECK (qty > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_allocations_reservation ON reservation_allocations (tenant_id, reservation_id);
CREATE INDEX idx_allocations_bin ON reservation_allocations (tenant_id, bin_id);
