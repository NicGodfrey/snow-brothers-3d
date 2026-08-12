-- Channel PRM: channel quotes (special pricing requests).
--
-- The customer-facing quote lives in sales-erp; this table records what the
-- partner asked for, what the channel authorized, and the link between the two.

CREATE TABLE prm_channel_quotes (
    id                    TEXT        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    number                TEXT        NOT NULL CHECK (number ~ '^CQ-[0-9]{5,}$'),
    partner_id            TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE RESTRICT,
    registration_id       TEXT REFERENCES prm_deal_registrations (id) ON DELETE SET NULL,
    customer_key          TEXT        NOT NULL,
    customer_name         TEXT        NOT NULL,
    currency              CHAR(3)     NOT NULL,
    status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'approved', 'rejected', 'expired', 'superseded', 'ordered')),
    submitted_at          TIMESTAMPTZ,
    submitted_by          TEXT,
    valid_until           TIMESTAMPTZ,
    requires_approval     BOOLEAN,
    decided_at            TIMESTAMPTZ,
    decided_by            TEXT,
    decision_notes        TEXT,
    approved_discount_bps INTEGER CHECK (approved_discount_bps BETWEEN 0 AND 10000),
    rejection_reason      TEXT,
    -- Handle for the sales-erp quote this pricing was applied to.
    sales_quote_system    TEXT,
    sales_quote_id        TEXT,
    sales_quote_number    TEXT,
    superseded_by_quote_id TEXT REFERENCES prm_channel_quotes (id) ON DELETE SET NULL,
    order_id              TEXT,
    notes                 TEXT,
    version               INTEGER     NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (status = 'draft' OR (submitted_at IS NOT NULL AND valid_until IS NOT NULL)),
    CHECK (status <> 'approved' OR approved_discount_bps IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK (status <> 'superseded' OR superseded_by_quote_id IS NOT NULL),
    CHECK (status <> 'ordered' OR order_id IS NOT NULL),
    CHECK ((sales_quote_id IS NULL) = (sales_quote_system IS NULL))
);
CREATE INDEX prm_channel_quotes_tenant_status_idx ON prm_channel_quotes (tenant_id, status);
CREATE INDEX prm_channel_quotes_partner_idx ON prm_channel_quotes (tenant_id, partner_id, status);
CREATE INDEX prm_channel_quotes_registration_idx ON prm_channel_quotes (registration_id);
CREATE INDEX prm_channel_quotes_validity_idx
    ON prm_channel_quotes (tenant_id, valid_until)
    WHERE status IN ('submitted', 'approved');

CREATE TABLE prm_channel_quote_lines (
    id                     TEXT     PRIMARY KEY,
    tenant_id              TEXT     NOT NULL,
    quote_id               TEXT     NOT NULL REFERENCES prm_channel_quotes (id) ON DELETE CASCADE,
    position               INTEGER  NOT NULL DEFAULT 0,
    product_line           TEXT     NOT NULL,
    sku                    TEXT,
    description            TEXT,
    quantity               NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    list_unit_price_minor  BIGINT   NOT NULL CHECK (list_unit_price_minor > 0),
    requested_unit_price_minor BIGINT NOT NULL CHECK (requested_unit_price_minor >= 0),
    approved_unit_price_minor  BIGINT,
    -- Uplifts are not a channel concept: a request never exceeds list, and a
    -- counter-offer never undercuts what the partner asked for.
    CHECK (requested_unit_price_minor <= list_unit_price_minor),
    CHECK (approved_unit_price_minor IS NULL
           OR (approved_unit_price_minor >= requested_unit_price_minor
               AND approved_unit_price_minor <= list_unit_price_minor))
);
CREATE INDEX prm_channel_quote_lines_quote_idx ON prm_channel_quote_lines (quote_id, position);
