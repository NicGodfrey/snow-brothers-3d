-- 0006: Putaway and pick execution tasks.

CREATE TABLE putaway_tasks (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    warehouse_id      TEXT NOT NULL REFERENCES warehouses (id),
    sku               TEXT NOT NULL,
    lot_id            TEXT REFERENCES lots (id),
    uom               TEXT NOT NULL DEFAULT 'EA',
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    from_bin_id       TEXT NOT NULL REFERENCES warehouse_bins (id),
    suggested_bin_id  TEXT NOT NULL REFERENCES warehouse_bins (id),
    actual_bin_id     TEXT REFERENCES warehouse_bins (id),
    status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    assigned_to       TEXT,
    source_ref_type   TEXT,
    source_ref_id     TEXT,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT chk_putaway_bins CHECK (from_bin_id <> suggested_bin_id),
    CONSTRAINT chk_putaway_assigned CHECK (status NOT IN ('ASSIGNED', 'IN_PROGRESS') OR assigned_to IS NOT NULL),
    CONSTRAINT chk_putaway_completed CHECK (
        (status = 'COMPLETED' AND actual_bin_id IS NOT NULL AND completed_at IS NOT NULL)
        OR status <> 'COMPLETED'
    )
);

CREATE INDEX idx_putaway_tenant_wh_status ON putaway_tasks (tenant_id, warehouse_id, status);
CREATE INDEX idx_putaway_assignee ON putaway_tasks (tenant_id, assigned_to)
    WHERE status IN ('ASSIGNED', 'IN_PROGRESS');

CREATE TABLE pick_tasks (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    reservation_id  TEXT NOT NULL REFERENCES reservations (id),
    allocation_id   TEXT NOT NULL REFERENCES reservation_allocations (id),
    sku             TEXT NOT NULL,
    lot_id          TEXT REFERENCES lots (id),
    uom             TEXT NOT NULL DEFAULT 'EA',
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    from_bin_id     TEXT NOT NULL REFERENCES warehouse_bins (id),
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ASSIGNED', 'PICKING', 'PICKED',
                                      'SHORT_PICKED', 'CANCELLED')),
    assigned_to     TEXT,
    picked_qty      INTEGER CHECK (picked_qty IS NULL OR picked_qty >= 0),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    -- One pick task per allocation (generation is idempotent).
    CONSTRAINT uq_pick_allocation UNIQUE (tenant_id, allocation_id),
    CONSTRAINT chk_pick_qty CHECK (picked_qty IS NULL OR picked_qty <= quantity),
    CONSTRAINT chk_pick_terminal CHECK (
        (status IN ('PICKED', 'SHORT_PICKED') AND picked_qty IS NOT NULL AND completed_at IS NOT NULL)
        OR status NOT IN ('PICKED', 'SHORT_PICKED')
    )
);

CREATE INDEX idx_pick_tenant_wh_status ON pick_tasks (tenant_id, warehouse_id, status);
CREATE INDEX idx_pick_reservation ON pick_tasks (tenant_id, reservation_id);
CREATE INDEX idx_pick_assignee ON pick_tasks (tenant_id, assigned_to)
    WHERE status IN ('ASSIGNED', 'PICKING');
