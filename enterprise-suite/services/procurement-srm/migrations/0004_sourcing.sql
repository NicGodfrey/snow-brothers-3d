-- Procurement SRM: RFQs, invitations and supplier quotes.
--
--   rfq:   draft → issued → closed → awarded
--   quote: draft → submitted → shortlisted → accepted / rejected / withdrawn
--
-- Issuing an RFQ freezes its scope; later changes bump the revision and land
-- in the amendment log so invited suppliers can be re-notified.

CREATE TABLE proc_rfqs (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    rfq_number           TEXT        NOT NULL CHECK (rfq_number ~ '^RFQ-\d{4}-\d{6,}$'),
    title                TEXT        NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
    buyer_id             TEXT        NOT NULL,
    currency             CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status               TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued', 'closed', 'awarded', 'cancelled')),
    -- Sealed bids stay hidden from comparison views until the RFQ closes.
    sealed               BOOLEAN     NOT NULL DEFAULT FALSE,
    response_deadline    DATE        NOT NULL,
    questions_deadline   DATE,
    incoterm             TEXT        NOT NULL DEFAULT 'DAP',
    payment_terms_days   SMALLINT    NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    delivery_location    TEXT        NOT NULL,
    -- Scoring weights, in basis points; they must total 10000 so scores are
    -- comparable across sourcing events.
    weight_price_bps      INTEGER    NOT NULL CHECK (weight_price_bps BETWEEN 0 AND 10000),
    weight_lead_time_bps  INTEGER    NOT NULL CHECK (weight_lead_time_bps BETWEEN 0 AND 10000),
    weight_quality_bps    INTEGER    NOT NULL CHECK (weight_quality_bps BETWEEN 0 AND 10000),
    weight_compliance_bps INTEGER    NOT NULL CHECK (weight_compliance_bps BETWEEN 0 AND 10000),
    revision             SMALLINT    NOT NULL DEFAULT 0 CHECK (revision >= 0),
    scope_notes          TEXT,
    issued_at            TIMESTAMPTZ,
    closed_at            TIMESTAMPTZ,
    awarded_at           TIMESTAMPTZ,
    cancellation_reason  TEXT,
    version              INTEGER     NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, rfq_number),
    CHECK (weight_price_bps + weight_lead_time_bps + weight_quality_bps + weight_compliance_bps = 10000),
    CHECK (questions_deadline IS NULL OR questions_deadline <= response_deadline),
    CHECK (status IN ('draft', 'cancelled') OR issued_at IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL)
);
CREATE INDEX proc_rfqs_tenant_status_idx ON proc_rfqs (tenant_id, status, response_deadline);

CREATE TABLE proc_rfq_lines (
    id                   TEXT           PRIMARY KEY,
    tenant_id            TEXT           NOT NULL,
    rfq_id               TEXT           NOT NULL REFERENCES proc_rfqs (id) ON DELETE CASCADE,
    line_number          INTEGER        NOT NULL CHECK (line_number > 0),
    description          TEXT           NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
    category_code        TEXT           NOT NULL,
    quantity             NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    uom                  TEXT           NOT NULL,
    required_by          DATE           NOT NULL,
    item_code            TEXT,
    specification        TEXT,
    requisition_id       TEXT           REFERENCES proc_requisitions (id),
    requisition_line_id  TEXT           REFERENCES proc_requisition_lines (id),
    alternatives_allowed BOOLEAN        NOT NULL DEFAULT TRUE,
    awarded_quote_id     TEXT,
    awarded_supplier_id  TEXT           REFERENCES proc_suppliers (id),
    UNIQUE (rfq_id, line_number),
    -- An award names both the winning quote and its supplier.
    CHECK ((awarded_quote_id IS NULL) = (awarded_supplier_id IS NULL))
);
CREATE INDEX proc_rfq_lines_requisition_idx
    ON proc_rfq_lines (tenant_id, requisition_id) WHERE requisition_id IS NOT NULL;

CREATE TABLE proc_rfq_invitations (
    tenant_id      TEXT        NOT NULL,
    rfq_id         TEXT        NOT NULL REFERENCES proc_rfqs (id) ON DELETE CASCADE,
    supplier_id    TEXT        NOT NULL REFERENCES proc_suppliers (id),
    invited_at     TIMESTAMPTZ NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'viewed', 'declined', 'responded')),
    quote_id       TEXT,
    decline_reason TEXT,
    responded_at   TIMESTAMPTZ,
    PRIMARY KEY (rfq_id, supplier_id),
    CHECK (status <> 'declined' OR decline_reason IS NOT NULL),
    CHECK (status <> 'responded' OR quote_id IS NOT NULL)
);
CREATE INDEX proc_rfq_invitations_supplier_idx ON proc_rfq_invitations (tenant_id, supplier_id);

CREATE TABLE proc_rfq_amendments (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    rfq_id      TEXT        NOT NULL REFERENCES proc_rfqs (id) ON DELETE CASCADE,
    revision    SMALLINT    NOT NULL CHECK (revision >= 1),
    note        TEXT        NOT NULL,
    amended_at  TIMESTAMPTZ NOT NULL,
    UNIQUE (rfq_id, revision)
);

-- An award may split an RFQ across suppliers, so it is stored per (quote,
-- line) rather than as a single winner on the header.
CREATE TABLE proc_rfq_awards (
    id           TEXT   PRIMARY KEY,
    tenant_id    TEXT   NOT NULL,
    rfq_id       TEXT   NOT NULL REFERENCES proc_rfqs (id) ON DELETE CASCADE,
    quote_id     TEXT   NOT NULL,
    supplier_id  TEXT   NOT NULL REFERENCES proc_suppliers (id),
    line_numbers INTEGER[] NOT NULL CHECK (cardinality(line_numbers) > 0),
    note         TEXT,
    UNIQUE (rfq_id, quote_id)
);

CREATE TABLE proc_quotes (
    id                 TEXT        PRIMARY KEY,
    tenant_id          TEXT        NOT NULL,
    quote_number       TEXT        NOT NULL CHECK (quote_number ~ '^QT-\d{4}-\d{6,}$'),
    rfq_id             TEXT        NOT NULL REFERENCES proc_rfqs (id) ON DELETE CASCADE,
    supplier_id        TEXT        NOT NULL REFERENCES proc_suppliers (id),
    currency           CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status             TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'shortlisted', 'rejected', 'accepted', 'withdrawn', 'expired')),
    valid_until        DATE        NOT NULL,
    incoterm           TEXT        NOT NULL DEFAULT 'DAP',
    payment_terms_days SMALLINT    NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    revision           SMALLINT    NOT NULL DEFAULT 0 CHECK (revision >= 0),
    supplier_reference TEXT,
    freight_minor      BIGINT      CHECK (freight_minor >= 0),
    notes              TEXT,
    submitted_at       TIMESTAMPTZ,
    withdrawn_reason   TEXT,
    rejection_reason   TEXT,
    decided_at         TIMESTAMPTZ,
    version            INTEGER     NOT NULL DEFAULT 1,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, quote_number),
    -- One live quote per supplier per RFQ; revisions replace it in place.
    UNIQUE (rfq_id, supplier_id),
    CHECK (status = 'draft' OR submitted_at IS NOT NULL),
    CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE INDEX proc_quotes_tenant_status_idx ON proc_quotes (tenant_id, status);
CREATE INDEX proc_quotes_supplier_idx ON proc_quotes (tenant_id, supplier_id);

CREATE TABLE proc_quote_lines (
    id                     TEXT           PRIMARY KEY,
    tenant_id              TEXT           NOT NULL,
    quote_id               TEXT           NOT NULL REFERENCES proc_quotes (id) ON DELETE CASCADE,
    rfq_line_number        INTEGER        NOT NULL CHECK (rfq_line_number > 0),
    unit_price_minor       BIGINT         NOT NULL CHECK (unit_price_minor >= 0),
    quantity               NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    uom                    TEXT           NOT NULL,
    lead_time_days         SMALLINT       NOT NULL CHECK (lead_time_days BETWEEN 0 AND 730),
    discount_bps           INTEGER        NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
    tax_bps                INTEGER        NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
    minimum_order_quantity NUMERIC(18, 6) CHECK (minimum_order_quantity > 0),
    alternative_item_code  TEXT,
    notes                  TEXT,
    UNIQUE (quote_id, rfq_line_number)
);
