-- Procurement SRM: purchase orders and change orders.
--
--   draft → pending_approval → approved → issued → acknowledged
--         → partially_received → received → closed
--
-- The line carries its own receipt and invoice history, which is what lets the
-- receipt tolerance check and the three-way match run without joining back to
-- the child documents.

CREATE TABLE proc_purchase_orders (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    order_number             TEXT        NOT NULL CHECK (order_number ~ '^PO-\d{4}-\d{6,}$'),
    revision                 SMALLINT    NOT NULL DEFAULT 0 CHECK (revision >= 0),
    supplier_id              TEXT        NOT NULL REFERENCES proc_suppliers (id),
    buyer_id                 TEXT        NOT NULL,
    currency                 CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status                   TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'approved', 'issued', 'acknowledged',
        'partially_received', 'received', 'closed', 'cancelled')),
    order_date               DATE        NOT NULL,
    incoterm                 TEXT        NOT NULL DEFAULT 'DAP',
    payment_terms_days       SMALLINT    NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    ship_to                  TEXT        NOT NULL,
    bill_to                  TEXT        NOT NULL,
    -- Tolerances are copied onto the order at creation so a later policy
    -- change cannot retroactively re-judge a receipt or an invoice.
    over_receipt_bps         INTEGER     NOT NULL DEFAULT 500 CHECK (over_receipt_bps BETWEEN 0 AND 10000),
    price_variance_bps       INTEGER     NOT NULL DEFAULT 200 CHECK (price_variance_bps BETWEEN 0 AND 10000),
    revision_reapproval_bps  INTEGER     NOT NULL DEFAULT 1000 CHECK (revision_reapproval_bps BETWEEN 0 AND 10000),
    source_type              TEXT        NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('manual', 'requisition', 'quote', 'agreement_release')),
    rfq_id                   TEXT        REFERENCES proc_rfqs (id),
    quote_id                 TEXT        REFERENCES proc_quotes (id),
    agreement_id             TEXT,
    approval_request_id      TEXT,
    supplier_reference       TEXT,
    notes                    TEXT,
    issued_at                TIMESTAMPTZ,
    acknowledged_at          TIMESTAMPTZ,
    closed_at                TIMESTAMPTZ,
    rejection_reason         TEXT,
    cancellation_reason      TEXT,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, order_number),
    -- Anything the supplier can act on has been issued.
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'cancelled') OR issued_at IS NOT NULL),
    CHECK (acknowledged_at IS NULL OR issued_at IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL),
    CHECK (source_type <> 'quote' OR quote_id IS NOT NULL),
    CHECK (source_type <> 'agreement_release' OR agreement_id IS NOT NULL)
);
CREATE INDEX proc_purchase_orders_tenant_status_idx ON proc_purchase_orders (tenant_id, status);
CREATE INDEX proc_purchase_orders_supplier_idx
    ON proc_purchase_orders (tenant_id, supplier_id, order_date);
CREATE INDEX proc_purchase_orders_agreement_idx
    ON proc_purchase_orders (tenant_id, agreement_id) WHERE agreement_id IS NOT NULL;

CREATE TABLE proc_purchase_order_lines (
    id                     TEXT           PRIMARY KEY,
    tenant_id              TEXT           NOT NULL,
    purchase_order_id      TEXT           NOT NULL REFERENCES proc_purchase_orders (id) ON DELETE CASCADE,
    line_number            INTEGER        NOT NULL CHECK (line_number > 0),
    description            TEXT           NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
    category_code          TEXT           NOT NULL,
    quantity               NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    uom                    TEXT           NOT NULL,
    unit_price_minor       BIGINT         NOT NULL CHECK (unit_price_minor >= 0),
    discount_bps           INTEGER        NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
    tax_bps                INTEGER        NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
    need_by                DATE           NOT NULL,
    promised_date          DATE,
    item_code              TEXT,
    requisition_id         TEXT           REFERENCES proc_requisitions (id),
    requisition_line_id    TEXT           REFERENCES proc_requisition_lines (id),
    quote_id               TEXT           REFERENCES proc_quotes (id),
    rfq_line_number        INTEGER,
    agreement_id           TEXT,
    agreement_line_number  INTEGER,
    charge_account         TEXT,
    notes                  TEXT,
    status                 TEXT           NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'partially_received', 'received', 'closed', 'cancelled')),
    received_quantity      NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    accepted_quantity      NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
    rejected_quantity      NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
    invoiced_quantity      NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (invoiced_quantity >= 0),
    invoiced_amount_minor  BIGINT         NOT NULL DEFAULT 0,
    close_reason           TEXT,
    cancellation_reason    TEXT,
    UNIQUE (purchase_order_id, line_number),
    -- Inspection moves quantity between accepted and rejected; it never
    -- changes what physically arrived.
    CHECK (accepted_quantity + rejected_quantity = received_quantity),
    -- Nothing may be invoiced that was not accepted.
    CHECK (invoiced_quantity <= accepted_quantity),
    CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL)
);
CREATE INDEX proc_purchase_order_lines_open_idx
    ON proc_purchase_order_lines (tenant_id, status, need_by) WHERE status IN ('open', 'partially_received');
CREATE INDEX proc_purchase_order_lines_requisition_idx
    ON proc_purchase_order_lines (tenant_id, requisition_line_id) WHERE requisition_line_id IS NOT NULL;

-- Change-order log. A value increase past revision_reapproval_bps sends the
-- order back through approval, which is recorded here rather than inferred.
CREATE TABLE proc_purchase_order_revisions (
    id                    TEXT        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    purchase_order_id     TEXT        NOT NULL REFERENCES proc_purchase_orders (id) ON DELETE CASCADE,
    revision              SMALLINT    NOT NULL CHECK (revision >= 1),
    reason                TEXT        NOT NULL,
    changed_by            TEXT        NOT NULL,
    previous_total_minor  BIGINT      NOT NULL,
    new_total_minor       BIGINT      NOT NULL,
    required_reapproval   BOOLEAN     NOT NULL,
    revised_at            TIMESTAMPTZ NOT NULL,
    UNIQUE (purchase_order_id, revision)
);

-- Requisitions covered by an order; an order may consolidate several.
CREATE TABLE proc_purchase_order_requisitions (
    tenant_id         TEXT NOT NULL,
    purchase_order_id TEXT NOT NULL REFERENCES proc_purchase_orders (id) ON DELETE CASCADE,
    requisition_id    TEXT NOT NULL REFERENCES proc_requisitions (id),
    PRIMARY KEY (purchase_order_id, requisition_id)
);
CREATE INDEX proc_purchase_order_requisitions_req_idx
    ON proc_purchase_order_requisitions (tenant_id, requisition_id);
