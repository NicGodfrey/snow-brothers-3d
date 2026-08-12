-- AR subledger: customer invoices and payments. customer_id references the
-- master-data service; it is an opaque external identifier here.
CREATE TABLE fin_ar_invoice (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    invoice_no       TEXT NOT NULL,
    customer_id      TEXT NOT NULL,
    customer_name    TEXT NOT NULL,
    currency         CHAR(3) NOT NULL,
    issue_date       DATE NOT NULL,
    due_date         DATE NOT NULL,
    status           TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
    subtotal_minor   BIGINT NOT NULL CHECK (subtotal_minor >= 0),
    tax_total_minor  BIGINT NOT NULL CHECK (tax_total_minor >= 0),
    total_minor      BIGINT NOT NULL CHECK (total_minor >= 0),
    paid_minor       BIGINT NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    journal_id       TEXT REFERENCES fin_journal (id),
    void_reason      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version          INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_ar_invoice_tenant_no UNIQUE (tenant_id, invoice_no),
    CONSTRAINT ck_fin_ar_invoice_paid CHECK (paid_minor <= total_minor),
    CONSTRAINT ck_fin_ar_invoice_dates CHECK (issue_date <= due_date)
);

CREATE INDEX idx_fin_ar_invoice_tenant_customer ON fin_ar_invoice (tenant_id, customer_id);
CREATE INDEX idx_fin_ar_invoice_tenant_status ON fin_ar_invoice (tenant_id, status);

CREATE TABLE fin_ar_invoice_line (
    invoice_id          TEXT NOT NULL REFERENCES fin_ar_invoice (id) ON DELETE CASCADE,
    line_no             INTEGER NOT NULL,
    description         TEXT NOT NULL,
    quantity_milli      BIGINT NOT NULL CHECK (quantity_milli > 0),   -- 1000 = 1 unit
    unit_price_minor    BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    revenue_account_id  TEXT NOT NULL REFERENCES fin_account (id),
    cost_center_id      TEXT REFERENCES fin_cost_center (id),
    tax_code_id         TEXT REFERENCES fin_tax_code (id),
    tax_rate_bps        INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
    subtotal_minor      BIGINT NOT NULL,
    tax_minor           BIGINT NOT NULL,
    total_minor         BIGINT NOT NULL,
    PRIMARY KEY (invoice_id, line_no)
);

CREATE TABLE fin_ar_payment (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    payment_no     TEXT NOT NULL,
    customer_id    TEXT NOT NULL,
    currency       CHAR(3) NOT NULL,
    amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
    received_date  DATE NOT NULL,
    method         TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER')),
    reference      TEXT,
    status         TEXT NOT NULL DEFAULT 'RECEIVED'
                   CHECK (status IN ('RECEIVED', 'PARTIALLY_APPLIED', 'APPLIED')),
    journal_id     TEXT REFERENCES fin_journal (id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_ar_payment_tenant_no UNIQUE (tenant_id, payment_no)
);

CREATE INDEX idx_fin_ar_payment_tenant_customer ON fin_ar_payment (tenant_id, customer_id);

CREATE TABLE fin_ar_payment_application (
    payment_id    TEXT NOT NULL REFERENCES fin_ar_payment (id) ON DELETE CASCADE,
    invoice_id    TEXT NOT NULL REFERENCES fin_ar_invoice (id),
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (payment_id, invoice_id)
);
