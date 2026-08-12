-- Procurement SRM: goods receipt notes.
--
--   draft → posted → reversed
--
-- Posting is the only moment quantities reach the purchase order, so a
-- tolerance breach is caught in one place. Reversals and returns to vendor
-- credit the order back rather than editing history.

CREATE TABLE proc_goods_receipts (
    id                      TEXT        PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    receipt_number          TEXT        NOT NULL CHECK (receipt_number ~ '^GRN-\d{4}-\d{6,}$'),
    purchase_order_id       TEXT        NOT NULL REFERENCES proc_purchase_orders (id),
    order_number            TEXT        NOT NULL,
    supplier_id             TEXT        NOT NULL REFERENCES proc_suppliers (id),
    received_by             TEXT        NOT NULL,
    receipt_date            DATE        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'posted', 'reversed')),
    delivery_note_reference TEXT,
    carrier                 TEXT,
    waybill_number          TEXT,
    notes                   TEXT,
    posted_at               TIMESTAMPTZ,
    reversed_at             TIMESTAMPTZ,
    reversal_reason         TEXT,
    version                 INTEGER     NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, receipt_number),
    CHECK (status <> 'draft' OR posted_at IS NULL),
    CHECK (status <> 'posted' OR posted_at IS NOT NULL),
    CHECK (status <> 'reversed' OR (posted_at IS NOT NULL AND reversed_at IS NOT NULL AND reversal_reason IS NOT NULL))
);
CREATE INDEX proc_goods_receipts_order_idx ON proc_goods_receipts (tenant_id, purchase_order_id);
CREATE INDEX proc_goods_receipts_supplier_idx
    ON proc_goods_receipts (tenant_id, supplier_id, receipt_date);

CREATE TABLE proc_goods_receipt_lines (
    id                        TEXT           PRIMARY KEY,
    tenant_id                 TEXT           NOT NULL,
    receipt_id                TEXT           NOT NULL REFERENCES proc_goods_receipts (id) ON DELETE CASCADE,
    line_number               INTEGER        NOT NULL CHECK (line_number > 0),
    purchase_order_line_number INTEGER       NOT NULL CHECK (purchase_order_line_number > 0),
    purchase_order_line_id    TEXT           REFERENCES proc_purchase_order_lines (id),
    item_code                 TEXT,
    description               TEXT,
    received_quantity         NUMERIC(18, 6) NOT NULL CHECK (received_quantity > 0),
    accepted_quantity         NUMERIC(18, 6) NOT NULL CHECK (accepted_quantity >= 0),
    rejected_quantity         NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
    uom                       TEXT           NOT NULL,
    rejection_reason          TEXT,
    inspection_status         TEXT           NOT NULL DEFAULT 'not_required' CHECK (inspection_status IN (
        'not_required', 'pending', 'passed', 'failed', 'partial')),
    storage_location          TEXT,
    lot_number                TEXT,
    serial_numbers            TEXT[],
    expiry_date               DATE,
    UNIQUE (receipt_id, line_number),
    CHECK (accepted_quantity + rejected_quantity = received_quantity),
    CHECK (rejected_quantity = 0 OR rejection_reason IS NOT NULL)
);
CREATE INDEX proc_goods_receipt_lines_order_line_idx
    ON proc_goods_receipt_lines (tenant_id, purchase_order_line_id);

-- Goods sent back after posting. The quantity is credited off the order line
-- so the three-way match sees the net accepted figure.
CREATE TABLE proc_receipt_returns (
    id            TEXT           PRIMARY KEY,
    tenant_id     TEXT           NOT NULL,
    receipt_line_id TEXT         NOT NULL REFERENCES proc_goods_receipt_lines (id) ON DELETE CASCADE,
    quantity      NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    reason        TEXT           NOT NULL,
    rma_reference TEXT,
    recorded_at   TIMESTAMPTZ    NOT NULL
);
CREATE INDEX proc_receipt_returns_line_idx ON proc_receipt_returns (tenant_id, receipt_line_id);
