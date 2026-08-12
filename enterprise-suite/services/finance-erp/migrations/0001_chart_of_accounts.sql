-- Chart of accounts. Codes are unique per tenant; summary accounts
-- (postable = false) group postable leaves via parent_code.
CREATE TABLE fin_account (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    code              TEXT NOT NULL,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    normal_balance    TEXT NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    currency          CHAR(3) NOT NULL,
    postable          BOOLEAN NOT NULL DEFAULT TRUE,
    parent_code       TEXT,
    description       TEXT,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_account_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_fin_account_tenant ON fin_account (tenant_id);
CREATE INDEX idx_fin_account_tenant_type ON fin_account (tenant_id, type);
CREATE INDEX idx_fin_account_parent ON fin_account (tenant_id, parent_code) WHERE parent_code IS NOT NULL;
