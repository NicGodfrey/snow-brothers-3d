-- Procurement SRM: purchase requisitions (the demand document).
--
--   draft → pending_approval → approved → partially_ordered → ordered → closed
--
-- Ordered quantity is tracked per line so a requisition can be split across
-- several suppliers and still know what demand remains uncovered.

CREATE TABLE proc_requisitions (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    requisition_number  TEXT        NOT NULL CHECK (requisition_number ~ '^PR-\d{4}-\d{6,}$'),
    title               TEXT        NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
    requester_id        TEXT        NOT NULL,
    cost_center         TEXT        NOT NULL CHECK (cost_center ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
    currency            CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    needed_by           DATE        NOT NULL,
    priority            TEXT        NOT NULL DEFAULT 'routine'
        CHECK (priority IN ('routine', 'urgent', 'emergency')),
    justification       TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'approved', 'rejected',
        'partially_ordered', 'ordered', 'closed', 'cancelled')),
    deliver_to          TEXT        NOT NULL,
    budget_code         TEXT,
    project_code        TEXT,
    approval_request_id TEXT,
    submitted_at        TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    rejection_reason    TEXT,
    cancellation_reason TEXT,
    close_reason        TEXT,
    notes               TEXT,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, requisition_number),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL),
    -- Anything past submission has a submission timestamp to age against.
    CHECK (status IN ('draft', 'cancelled') OR submitted_at IS NOT NULL)
);
CREATE INDEX proc_requisitions_tenant_status_idx ON proc_requisitions (tenant_id, status);
CREATE INDEX proc_requisitions_requester_idx ON proc_requisitions (tenant_id, requester_id);
CREATE INDEX proc_requisitions_cost_center_idx ON proc_requisitions (tenant_id, cost_center);

CREATE TABLE proc_requisition_lines (
    id                     TEXT           PRIMARY KEY,
    tenant_id              TEXT           NOT NULL,
    requisition_id         TEXT           NOT NULL REFERENCES proc_requisitions (id) ON DELETE CASCADE,
    line_number            INTEGER        NOT NULL CHECK (line_number > 0),
    description            TEXT           NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
    category_code          TEXT           NOT NULL,
    quantity               NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    uom                    TEXT           NOT NULL CHECK (uom ~ '^[A-Z0-9]{1,10}$'),
    estimated_price_minor  BIGINT         NOT NULL CHECK (estimated_price_minor >= 0),
    needed_by              DATE,
    item_code              TEXT,
    suggested_supplier_id  TEXT           REFERENCES proc_suppliers (id),
    gl_account             TEXT,
    notes                  TEXT,
    status                 TEXT           NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'sourcing', 'partially_ordered', 'ordered', 'cancelled')),
    ordered_quantity       NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (ordered_quantity >= 0),
    rfq_id                 TEXT,
    agreement_id           TEXT,
    cancellation_reason    TEXT,
    UNIQUE (requisition_id, line_number),
    -- Over-ordering demand is a data error: the buyer must revise the line.
    CHECK (ordered_quantity <= quantity),
    CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL)
);
CREATE INDEX proc_requisition_lines_category_idx
    ON proc_requisition_lines (tenant_id, category_code, status);

-- Which orders covered which line. A line may be split across suppliers, so
-- this is a set rather than a column on the line.
CREATE TABLE proc_requisition_line_orders (
    tenant_id            TEXT NOT NULL,
    requisition_line_id  TEXT NOT NULL REFERENCES proc_requisition_lines (id) ON DELETE CASCADE,
    purchase_order_id    TEXT NOT NULL,
    PRIMARY KEY (requisition_line_id, purchase_order_id)
);
