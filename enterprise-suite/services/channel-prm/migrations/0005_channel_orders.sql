-- Channel PRM: channel orders referencing booked sales orders.

CREATE TABLE prm_channel_orders (
    id                 TEXT        PRIMARY KEY,
    tenant_id          TEXT        NOT NULL,
    number             TEXT        NOT NULL CHECK (number ~ '^CO-[0-9]{5,}$'),
    partner_id         TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE RESTRICT,
    registration_id    TEXT REFERENCES prm_deal_registrations (id) ON DELETE SET NULL,
    channel_quote_id   TEXT REFERENCES prm_channel_quotes (id) ON DELETE SET NULL,
    customer_key       TEXT        NOT NULL,
    customer_name      TEXT        NOT NULL,
    sales_order_system TEXT        NOT NULL DEFAULT 'sales-erp',
    sales_order_id     TEXT        NOT NULL,
    sales_order_number TEXT,
    po_number          TEXT,
    net_value_minor    BIGINT      NOT NULL CHECK (net_value_minor > 0),
    list_value_minor   BIGINT      CHECK (list_value_minor IS NULL OR list_value_minor >= net_value_minor),
    currency           CHAR(3)     NOT NULL,
    partner_margin_bps INTEGER     CHECK (partner_margin_bps BETWEEN 0 AND 10000),
    source_type        TEXT        NOT NULL DEFAULT 'partner_sourced'
        CHECK (source_type IN ('partner_sourced', 'vendor_sourced', 'co_sell')),
    status             TEXT        NOT NULL DEFAULT 'placed'
        CHECK (status IN ('placed', 'invoiced', 'fulfilled', 'cancelled')),
    ordered_at         TIMESTAMPTZ NOT NULL,
    invoiced_at        TIMESTAMPTZ,
    invoice_system     TEXT,
    invoice_id         TEXT,
    fulfilled_at       TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ,
    cancelled_reason   TEXT,
    version            INTEGER     NOT NULL DEFAULT 1,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    -- One channel order per sales order: attainment must never double count.
    UNIQUE (tenant_id, sales_order_id),
    CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
    CHECK (status <> 'fulfilled' OR fulfilled_at IS NOT NULL),
    CHECK (invoiced_at IS NULL OR invoiced_at >= ordered_at)
);
CREATE INDEX prm_channel_orders_tenant_status_idx ON prm_channel_orders (tenant_id, status);
CREATE INDEX prm_channel_orders_partner_period_idx
    ON prm_channel_orders (tenant_id, partner_id, ordered_at);
CREATE INDEX prm_channel_orders_registration_idx ON prm_channel_orders (registration_id);
CREATE INDEX prm_channel_orders_source_idx ON prm_channel_orders (tenant_id, source_type, ordered_at);

-- Now that orders exist, close the quote -> order reference.
ALTER TABLE prm_channel_quotes
    ADD CONSTRAINT prm_channel_quotes_order_fk
    FOREIGN KEY (order_id) REFERENCES prm_channel_orders (id) ON DELETE SET NULL;
