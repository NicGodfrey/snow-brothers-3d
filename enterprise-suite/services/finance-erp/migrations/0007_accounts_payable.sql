-- AP subledger: supplier bills and payments. supplier_id references srm-core.
CREATE TABLE fin_ap_bill (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    bill_no               TEXT NOT NULL,
    supplier_id           TEXT NOT NULL,
    supplier_name         TEXT NOT NULL,
    supplier_invoice_ref  TEXT,
    currency              CHAR(3) NOT NULL,
    bill_date             DATE NOT NULL,
    due_date              DATE NOT NULL,
    status                TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
    subtotal_minor        BIGINT NOT NULL CHECK (subtotal_minor >= 0),
    tax_total_minor       BIGINT NOT NULL CHECK (tax_total_minor >= 0),
    total_minor           BIGINT NOT NULL CHECK (total_minor >= 0),
    paid_minor            BIGINT NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    journal_id            TEXT REFERENCES fin_journal (id),
    void_reason           TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    version               INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_ap_bill_tenant_no UNIQUE (tenant_id, bill_no),
    CONSTRAINT ck_fin_ap_bill_paid CHECK (paid_minor <= total_minor),
    CONSTRAINT ck_fin_ap_bill_dates CHECK (bill_date <= due_date)
);

CREATE INDEX idx_fin_ap_bill_tenant_supplier ON fin_ap_bill (tenant_id, supplier_id);
CREATE INDEX idx_fin_ap_bill_tenant_status ON fin_ap_bill (tenant_id, status);

CREATE TABLE fin_ap_bill_line (
    bill_id             TEXT NOT NULL REFERENCES fin_ap_bill (id) ON DELETE CASCADE,
    line_no             INTEGER NOT NULL,
    description         TEXT NOT NULL,
    quantity_milli      BIGINT NOT NULL CHECK (quantity_milli > 0),
    unit_cost_minor     BIGINT NOT NULL CHECK (unit_cost_minor >= 0),
    expense_account_id  TEXT NOT NULL REFERENCES fin_account (id),
    cost_center_id      TEXT REFERENCES fin_cost_center (id),
    tax_code_id         TEXT REFERENCES fin_tax_code (id),
    tax_rate_bps        INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
    subtotal_minor      BIGINT NOT NULL,
    tax_minor           BIGINT NOT NULL,
    total_minor         BIGINT NOT NULL,
    PRIMARY KEY (bill_id, line_no)
);

CREATE TABLE fin_ap_payment (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    payment_no    TEXT NOT NULL,
    supplier_id   TEXT NOT NULL,
    currency      CHAR(3) NOT NULL,
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    payment_date  DATE NOT NULL,
    method        TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER')),
    reference     TEXT,
    status        TEXT NOT NULL DEFAULT 'ISSUED'
                  CHECK (status IN ('ISSUED', 'PARTIALLY_APPLIED', 'APPLIED')),
    journal_id    TEXT REFERENCES fin_journal (id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_ap_payment_tenant_no UNIQUE (tenant_id, payment_no)
);

CREATE INDEX idx_fin_ap_payment_tenant_supplier ON fin_ap_payment (tenant_id, supplier_id);

CREATE TABLE fin_ap_payment_application (
    payment_id    TEXT NOT NULL REFERENCES fin_ap_payment (id) ON DELETE CASCADE,
    bill_id       TEXT NOT NULL REFERENCES fin_ap_bill (id),
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (payment_id, bill_id)
);
