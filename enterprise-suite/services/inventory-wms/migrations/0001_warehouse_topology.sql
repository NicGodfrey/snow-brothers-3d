-- 0001: Warehouse topology — warehouses, zones, bins.
-- All tables are tenant-scoped; unique keys always include tenant_id.

CREATE TABLE warehouses (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE')),
    address_line1   TEXT,
    city            TEXT,
    country         TEXT,
    timezone        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_warehouses_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_warehouses_tenant ON warehouses (tenant_id);

CREATE TABLE warehouse_zones (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    zone_type       TEXT NOT NULL
                    CHECK (zone_type IN ('RECEIVING', 'STORAGE', 'PICKING', 'PACKING',
                                         'SHIPPING', 'QUARANTINE', 'RETURNS')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_zones_tenant_wh_code UNIQUE (tenant_id, warehouse_id, code)
);

CREATE INDEX idx_zones_tenant_wh ON warehouse_zones (tenant_id, warehouse_id);

CREATE TABLE warehouse_bins (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    zone_id         TEXT NOT NULL REFERENCES warehouse_zones (id),
    code            TEXT NOT NULL,
    bin_type        TEXT NOT NULL
                    CHECK (bin_type IN ('PALLET', 'SHELF', 'FLOOR', 'FLOW_RACK', 'BULK', 'STAGING')),
    status          TEXT NOT NULL DEFAULT 'AVAILABLE'
                    CHECK (status IN ('AVAILABLE', 'BLOCKED')),
    blocked_reason  TEXT,
    max_units       INTEGER CHECK (max_units IS NULL OR max_units >= 0),
    pick_sequence   INTEGER NOT NULL DEFAULT 0 CHECK (pick_sequence >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    -- Bin codes are unique per warehouse (not per zone) so scanner input is unambiguous.
    CONSTRAINT uq_bins_tenant_wh_code UNIQUE (tenant_id, warehouse_id, code)
);

CREATE INDEX idx_bins_tenant_wh ON warehouse_bins (tenant_id, warehouse_id);
CREATE INDEX idx_bins_tenant_zone ON warehouse_bins (tenant_id, zone_id);
CREATE INDEX idx_bins_pick_walk ON warehouse_bins (tenant_id, warehouse_id, pick_sequence);
