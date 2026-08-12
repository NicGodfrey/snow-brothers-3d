-- General ledger journals. Amounts are integer minor units (BIGINT); one of
-- debit_minor / credit_minor is non-zero per line and each journal balances.
CREATE TABLE fin_journal (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    journal_no      TEXT NOT NULL,
    journal_date    DATE NOT NULL,
    period_code     TEXT NOT NULL,
    currency        CHAR(3) NOT NULL,
    source          TEXT NOT NULL DEFAULT 'MANUAL'
                    CHECK (source IN ('MANUAL', 'AR', 'AP', 'ALLOCATION', 'CLOSING', 'SYSTEM')),
    status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    memo            TEXT,
    posted_at       TIMESTAMPTZ,
    posted_by       TEXT,
    reversal_of_id  TEXT REFERENCES fin_journal (id),
    reversed_by_id  TEXT REFERENCES fin_journal (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_journal_tenant_no UNIQUE (tenant_id, journal_no)
);

CREATE INDEX idx_fin_journal_tenant_period ON fin_journal (tenant_id, period_code);
CREATE INDEX idx_fin_journal_tenant_date ON fin_journal (tenant_id, journal_date);
CREATE INDEX idx_fin_journal_tenant_status ON fin_journal (tenant_id, status);

CREATE TABLE fin_journal_line (
    journal_id      TEXT NOT NULL REFERENCES fin_journal (id) ON DELETE CASCADE,
    line_no         INTEGER NOT NULL,
    account_id      TEXT NOT NULL REFERENCES fin_account (id),
    account_code    TEXT NOT NULL,
    cost_center_id  TEXT REFERENCES fin_cost_center (id),
    description     TEXT,
    debit_minor     BIGINT NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor    BIGINT NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
    PRIMARY KEY (journal_id, line_no),
    CONSTRAINT ck_fin_journal_line_one_side
        CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);

CREATE INDEX idx_fin_journal_line_account ON fin_journal_line (account_id);
CREATE INDEX idx_fin_journal_line_cost_center ON fin_journal_line (cost_center_id)
    WHERE cost_center_id IS NOT NULL;

-- Per-tenant document numbering sequences (journals, invoices, bills, payments).
CREATE TABLE fin_doc_sequence (
    tenant_id  TEXT NOT NULL,
    prefix     TEXT NOT NULL,               -- 'JRN', 'INV', 'RCPT', 'BILL', 'PAY'
    next_value BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, prefix)
);
