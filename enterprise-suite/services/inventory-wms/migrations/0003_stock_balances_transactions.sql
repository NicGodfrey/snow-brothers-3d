-- 0003: Stock balances and the append-only inventory transaction ledger.

CREATE TABLE stock_balances (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    bin_id          TEXT NOT NULL REFERENCES warehouse_bins (id),
    sku             TEXT NOT NULL,
    -- Empty string sentinel for "no lot" keeps the composite unique key simple
    -- (Postgres treats NULLs as distinct in unique constraints).
    lot_id          TEXT NOT NULL DEFAULT '',
    uom             TEXT NOT NULL DEFAULT 'EA',
    on_hand         INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
    reserved        INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    available       INTEGER GENERATED ALWAYS AS (on_hand - reserved) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    -- The core invariant of the whole context.
    CONSTRAINT chk_balances_reserved_lte_on_hand CHECK (reserved <= on_hand),
    CONSTRAINT uq_balances_identity UNIQUE (tenant_id, warehouse_id, bin_id, sku, lot_id)
);

CREATE INDEX idx_balances_tenant_sku ON stock_balances (tenant_id, sku);
CREATE INDEX idx_balances_tenant_wh_sku ON stock_balances (tenant_id, warehouse_id, sku);
CREATE INDEX idx_balances_tenant_bin ON stock_balances (tenant_id, bin_id);
-- Allocation scans only care about balances with availability.
CREATE INDEX idx_balances_allocatable ON stock_balances (tenant_id, warehouse_id, sku)
    WHERE on_hand - reserved > 0;

CREATE TABLE inventory_transactions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    txn_type        TEXT NOT NULL
                    CHECK (txn_type IN ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'COUNT_ADJUSTMENT')),
    warehouse_id    TEXT NOT NULL REFERENCES warehouses (id),
    sku             TEXT NOT NULL,
    lot_id          TEXT REFERENCES lots (id),
    uom             TEXT NOT NULL DEFAULT 'EA',
    -- Positive for movements; signed delta for adjustments.
    quantity        INTEGER NOT NULL CHECK (quantity <> 0),
    from_bin_id     TEXT REFERENCES warehouse_bins (id),
    to_bin_id       TEXT REFERENCES warehouse_bins (id),
    reason_code     TEXT CHECK (reason_code IS NULL OR reason_code IN
                        ('DAMAGE', 'SHRINKAGE', 'FOUND', 'CORRECTION', 'EXPIRY', 'CYCLE_COUNT')),
    ref_type        TEXT CHECK (ref_type IS NULL OR ref_type IN
                        ('PURCHASE_ORDER', 'SALES_ORDER', 'CYCLE_COUNT', 'PUTAWAY_TASK',
                         'PICK_TASK', 'RETURN', 'MANUAL')),
    ref_id          TEXT,
    note            TEXT,
    actor_id        TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Ledger rows must be well-formed per type.
    CONSTRAINT chk_txn_shape CHECK (
        (txn_type = 'RECEIPT'  AND to_bin_id IS NOT NULL AND from_bin_id IS NULL AND quantity > 0)
     OR (txn_type = 'ISSUE'    AND from_bin_id IS NOT NULL AND to_bin_id IS NULL AND quantity > 0)
     OR (txn_type = 'TRANSFER' AND from_bin_id IS NOT NULL AND to_bin_id IS NOT NULL
                               AND from_bin_id <> to_bin_id AND quantity > 0)
     OR (txn_type IN ('ADJUSTMENT', 'COUNT_ADJUSTMENT')
                               AND to_bin_id IS NOT NULL AND reason_code IS NOT NULL)
    ),
    CONSTRAINT chk_txn_ref CHECK ((ref_type IS NULL) = (ref_id IS NULL))
);

CREATE INDEX idx_txn_tenant_sku_time ON inventory_transactions (tenant_id, sku, occurred_at);
CREATE INDEX idx_txn_tenant_wh_time ON inventory_transactions (tenant_id, warehouse_id, occurred_at);
CREATE INDEX idx_txn_ref ON inventory_transactions (tenant_id, ref_type, ref_id)
    WHERE ref_type IS NOT NULL;

-- The ledger is append-only: no UPDATE or DELETE, enforced at the DB layer.
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_transactions is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_immutable
    BEFORE UPDATE OR DELETE ON inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
