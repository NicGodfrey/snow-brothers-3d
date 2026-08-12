-- 0002: Lot (batch) and serial-number tracking.

CREATE TABLE lots (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    sku             TEXT NOT NULL,
    lot_code        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'AVAILABLE'
                    CHECK (status IN ('AVAILABLE', 'QUARANTINE', 'EXPIRED', 'CONSUMED')),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    manufactured_at TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    supplier_ref    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_lots_tenant_sku_code UNIQUE (tenant_id, sku, lot_code),
    CONSTRAINT chk_lots_dates CHECK (
        manufactured_at IS NULL OR expires_at IS NULL OR manufactured_at < expires_at
    )
);

CREATE INDEX idx_lots_tenant_sku ON lots (tenant_id, sku);
-- FEFO allocation scans by expiry.
CREATE INDEX idx_lots_fefo ON lots (tenant_id, sku, expires_at NULLS LAST)
    WHERE status = 'AVAILABLE';

CREATE TABLE serial_units (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    sku             TEXT NOT NULL,
    serial_number   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'IN_STOCK'
                    CHECK (status IN ('IN_STOCK', 'RESERVED', 'SHIPPED', 'RETURNED', 'SCRAPPED')),
    warehouse_id    TEXT REFERENCES warehouses (id),
    bin_id          TEXT REFERENCES warehouse_bins (id),
    lot_id          TEXT REFERENCES lots (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_serials_tenant_sku_serial UNIQUE (tenant_id, sku, serial_number),
    -- Units physically in stock must have a location; shipped/scrapped must not.
    CONSTRAINT chk_serials_location CHECK (
        (status IN ('IN_STOCK', 'RESERVED') AND bin_id IS NOT NULL)
        OR (status IN ('SHIPPED', 'SCRAPPED') AND bin_id IS NULL)
        OR status = 'RETURNED'
    )
);

CREATE INDEX idx_serials_tenant_sku ON serial_units (tenant_id, sku);
CREATE INDEX idx_serials_tenant_bin ON serial_units (tenant_id, bin_id) WHERE bin_id IS NOT NULL;
