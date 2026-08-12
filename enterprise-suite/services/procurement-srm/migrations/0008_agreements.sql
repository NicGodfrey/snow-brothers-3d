-- Procurement SRM: blanket / contract agreements and their releases.
--
--   draft → active ⇄ suspended → expired / closed
--
-- A release reserves value and quantity before the purchase order is issued,
-- so two buyers cannot both spend the last of an agreement. Cancelling the
-- order returns the reservation.

CREATE TABLE proc_agreements (
    id                      TEXT        PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    agreement_number        TEXT        NOT NULL CHECK (agreement_number ~ '^BPA-\d{4}-\d{6,}$'),
    title                   TEXT        NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
    supplier_id             TEXT        NOT NULL REFERENCES proc_suppliers (id),
    owner_id                TEXT        NOT NULL,
    agreement_type          TEXT        NOT NULL DEFAULT 'blanket'
        CHECK (agreement_type IN ('blanket', 'contract', 'standing')),
    currency                CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status                  TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'active', 'suspended', 'expired', 'closed', 'cancelled')),
    effective_from          DATE        NOT NULL,
    effective_to            DATE        NOT NULL,
    payment_terms_days      SMALLINT    NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    incoterm                TEXT        NOT NULL DEFAULT 'DAP',
    maximum_value_minor     BIGINT      NOT NULL CHECK (maximum_value_minor > 0),
    minimum_commitment_minor BIGINT     CHECK (minimum_commitment_minor >= 0),
    release_limit_minor     BIGINT      CHECK (release_limit_minor > 0),
    released_value_minor    BIGINT      NOT NULL DEFAULT 0 CHECK (released_value_minor >= 0),
    -- Releases inside the negotiated limits skip the purchase-order chain.
    auto_release_approved   BOOLEAN     NOT NULL DEFAULT FALSE,
    renewal_notice_days     SMALLINT    NOT NULL DEFAULT 30 CHECK (renewal_notice_days BETWEEN 0 AND 365),
    commitment_notified     BOOLEAN     NOT NULL DEFAULT FALSE,
    notes                   TEXT,
    activated_at            TIMESTAMPTZ,
    suspended_reason        TEXT,
    closed_at               TIMESTAMPTZ,
    close_reason            TEXT,
    version                 INTEGER     NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, agreement_number),
    CHECK (effective_to >= effective_from),
    CHECK (minimum_commitment_minor IS NULL OR minimum_commitment_minor <= maximum_value_minor),
    CHECK (released_value_minor <= maximum_value_minor),
    CHECK (status <> 'suspended' OR suspended_reason IS NOT NULL),
    CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND close_reason IS NOT NULL)),
    CHECK (status = 'draft' OR activated_at IS NOT NULL)
);
CREATE INDEX proc_agreements_supplier_idx ON proc_agreements (tenant_id, supplier_id, status);
CREATE INDEX proc_agreements_active_idx
    ON proc_agreements (tenant_id, effective_from, effective_to) WHERE status = 'active';

CREATE TABLE proc_agreement_lines (
    id                  TEXT           PRIMARY KEY,
    tenant_id           TEXT           NOT NULL,
    agreement_id        TEXT           NOT NULL REFERENCES proc_agreements (id) ON DELETE CASCADE,
    line_number         INTEGER        NOT NULL CHECK (line_number > 0),
    description         TEXT           NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
    category_code       TEXT           NOT NULL,
    uom                 TEXT           NOT NULL,
    item_code           TEXT,
    contracted_quantity NUMERIC(18, 6) CHECK (contracted_quantity > 0),
    maximum_quantity    NUMERIC(18, 6) CHECK (maximum_quantity > 0),
    released_quantity   NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
    lead_time_days      SMALLINT       CHECK (lead_time_days BETWEEN 0 AND 730),
    UNIQUE (agreement_id, line_number),
    CHECK (maximum_quantity IS NULL OR contracted_quantity IS NULL OR maximum_quantity >= contracted_quantity),
    CHECK (maximum_quantity IS NULL OR released_quantity <= maximum_quantity)
);
CREATE INDEX proc_agreement_lines_item_idx
    ON proc_agreement_lines (tenant_id, item_code) WHERE item_code IS NOT NULL;

-- Volume price breaks. The tier with min_quantity = 0 and no date window is
-- the base price every line is created with; further tiers may be date-scoped
-- for price changes agreed up front.
CREATE TABLE proc_agreement_price_tiers (
    id               TEXT           PRIMARY KEY,
    tenant_id        TEXT           NOT NULL,
    agreement_line_id TEXT          NOT NULL REFERENCES proc_agreement_lines (id) ON DELETE CASCADE,
    min_quantity     NUMERIC(18, 6) NOT NULL CHECK (min_quantity >= 0),
    unit_price_minor BIGINT         NOT NULL CHECK (unit_price_minor > 0),
    effective_from   DATE,
    effective_to     DATE,
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX proc_agreement_price_tiers_unique_idx
    ON proc_agreement_price_tiers (
        agreement_line_id,
        min_quantity,
        COALESCE(effective_from, DATE '0001-01-01'),
        COALESCE(effective_to, DATE '9999-12-31')
    );

CREATE TABLE proc_agreement_releases (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    agreement_id      TEXT        NOT NULL REFERENCES proc_agreements (id) ON DELETE CASCADE,
    purchase_order_id TEXT        NOT NULL REFERENCES proc_purchase_orders (id),
    order_number      TEXT        NOT NULL,
    released_by       TEXT        NOT NULL,
    released_at       TIMESTAMPTZ NOT NULL,
    value_minor       BIGINT      NOT NULL CHECK (value_minor >= 0),
    cancelled         BOOLEAN     NOT NULL DEFAULT FALSE
);
-- One live release per order; a cancelled one stays for the audit trail.
CREATE UNIQUE INDEX proc_agreement_releases_order_idx
    ON proc_agreement_releases (purchase_order_id) WHERE cancelled = FALSE;

CREATE TABLE proc_agreement_release_lines (
    tenant_id        TEXT           NOT NULL,
    release_id       TEXT           NOT NULL REFERENCES proc_agreement_releases (id) ON DELETE CASCADE,
    line_number      INTEGER        NOT NULL CHECK (line_number > 0),
    quantity         NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    unit_price_minor BIGINT         NOT NULL CHECK (unit_price_minor >= 0),
    PRIMARY KEY (release_id, line_number)
);
