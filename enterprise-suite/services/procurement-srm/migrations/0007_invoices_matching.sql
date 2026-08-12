-- Procurement SRM: supplier invoices and the three-way match.
--
--   registered → matched → approved_for_payment
--              ↘ exception ⇄ on_hold → rejected
--
-- Procurement stops at "approved for payment": posting the AP entry and
-- running the payment belong to finance-erp, which consumes
-- procurement.invoice.approved_for_payment.

CREATE TABLE proc_supplier_invoices (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    invoice_number           TEXT        NOT NULL CHECK (invoice_number ~ '^INV-\d{4}-\d{6,}$'),
    supplier_invoice_number  TEXT        NOT NULL,
    -- Case- and punctuation-insensitive form of the supplier's reference; the
    -- duplicate check runs against this, not the printed string.
    normalized_reference     TEXT        NOT NULL,
    supplier_id              TEXT        NOT NULL REFERENCES proc_suppliers (id),
    purchase_order_id        TEXT        REFERENCES proc_purchase_orders (id),
    currency                 CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status                   TEXT        NOT NULL DEFAULT 'registered' CHECK (status IN (
        'registered', 'matched', 'exception', 'on_hold',
        'approved_for_payment', 'rejected', 'cancelled')),
    invoice_date             DATE        NOT NULL,
    received_date            DATE        NOT NULL,
    due_date                 DATE        NOT NULL,
    payment_terms_days       SMALLINT    NOT NULL CHECK (payment_terms_days BETWEEN 0 AND 365),
    declared_total_minor     BIGINT      NOT NULL,
    declared_tax_total_minor BIGINT,
    hold_reason              TEXT,
    rejection_reason         TEXT,
    cancellation_reason      TEXT,
    approved_by              TEXT,
    approved_at              TIMESTAMPTZ,
    notes                    TEXT,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, invoice_number),
    CHECK (due_date >= invoice_date),
    CHECK (status <> 'on_hold' OR hold_reason IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK (status <> 'approved_for_payment' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX proc_supplier_invoices_status_idx ON proc_supplier_invoices (tenant_id, status, due_date);
CREATE INDEX proc_supplier_invoices_order_idx
    ON proc_supplier_invoices (tenant_id, purchase_order_id) WHERE purchase_order_id IS NOT NULL;
-- Duplicate detection: the same supplier reference may not be live twice.
CREATE UNIQUE INDEX proc_supplier_invoices_reference_idx
    ON proc_supplier_invoices (tenant_id, supplier_id, normalized_reference)
    WHERE status NOT IN ('rejected', 'cancelled');

CREATE TABLE proc_invoice_lines (
    id                         TEXT           PRIMARY KEY,
    tenant_id                  TEXT           NOT NULL,
    invoice_id                 TEXT           NOT NULL REFERENCES proc_supplier_invoices (id) ON DELETE CASCADE,
    line_number                INTEGER        NOT NULL CHECK (line_number > 0),
    description                TEXT           NOT NULL CHECK (length(description) BETWEEN 2 AND 500),
    quantity                   NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    uom                        TEXT           NOT NULL,
    unit_price_minor           BIGINT         NOT NULL CHECK (unit_price_minor >= 0),
    tax_bps                    INTEGER        NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
    purchase_order_line_number INTEGER        CHECK (purchase_order_line_number > 0),
    item_code                  TEXT,
    gl_account                 TEXT,
    -- Freight and misc charges have no order line to match against; they are
    -- reconciled by description or flagged for a buyer.
    charge_type                TEXT           NOT NULL DEFAULT 'goods'
        CHECK (charge_type IN ('goods', 'freight', 'misc')),
    UNIQUE (invoice_id, line_number)
);

-- Verdict of the latest match run, kept whole so it can be replayed for audit
-- or re-scored under different tolerances without re-reading the documents.
CREATE TABLE proc_match_results (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    invoice_id               TEXT        NOT NULL REFERENCES proc_supplier_invoices (id) ON DELETE CASCADE,
    status                   TEXT        NOT NULL CHECK (status IN ('matched', 'exception')),
    match_type               TEXT        NOT NULL CHECK (match_type IN ('two_way', 'three_way')),
    matched_at               TIMESTAMPTZ NOT NULL,
    price_variance_bps       INTEGER     NOT NULL CHECK (price_variance_bps >= 0),
    quantity_variance_bps    INTEGER     NOT NULL CHECK (quantity_variance_bps >= 0),
    total_rounding_minor     INTEGER     NOT NULL CHECK (total_rounding_minor >= 0),
    require_receipt          BOOLEAN     NOT NULL,
    ordered_value_minor      BIGINT      NOT NULL,
    received_value_minor     BIGINT      NOT NULL,
    invoiced_value_minor     BIGINT      NOT NULL,
    computed_total_minor     BIGINT      NOT NULL,
    total_variance_minor     BIGINT      NOT NULL,
    price_variance_minor     BIGINT      NOT NULL,
    quantity_variance        NUMERIC(18, 6) NOT NULL,
    -- Per-line detail as returned by the engine; read-only reporting payload.
    lines                    JSONB       NOT NULL
);
-- Only the latest run is kept per invoice; history lives in the outbox.
CREATE UNIQUE INDEX proc_match_results_invoice_idx ON proc_match_results (invoice_id);

CREATE TABLE proc_match_exceptions (
    id           TEXT    PRIMARY KEY,
    tenant_id    TEXT    NOT NULL,
    invoice_id   TEXT    NOT NULL REFERENCES proc_supplier_invoices (id) ON DELETE CASCADE,
    code         TEXT    NOT NULL,
    severity     TEXT    NOT NULL CHECK (severity IN ('blocking', 'warning')),
    message      TEXT    NOT NULL,
    line_number  INTEGER CHECK (line_number > 0),
    details      JSONB,
    resolved     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX proc_match_exceptions_open_idx
    ON proc_match_exceptions (tenant_id, code) WHERE resolved = FALSE;

-- Buyers clear exceptions either by fixing the data ('resolved', a re-match is
-- expected) or by accepting the discrepancy on the record ('waived').
CREATE TABLE proc_exception_resolutions (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    invoice_id  TEXT        NOT NULL REFERENCES proc_supplier_invoices (id) ON DELETE CASCADE,
    code        TEXT        NOT NULL,
    line_number INTEGER     CHECK (line_number > 0),
    action      TEXT        NOT NULL CHECK (action IN ('resolved', 'waived')),
    note        TEXT        NOT NULL CHECK (length(note) BETWEEN 3 AND 500),
    resolved_by TEXT        NOT NULL,
    resolved_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX proc_exception_resolutions_invoice_idx
    ON proc_exception_resolutions (tenant_id, invoice_id);
