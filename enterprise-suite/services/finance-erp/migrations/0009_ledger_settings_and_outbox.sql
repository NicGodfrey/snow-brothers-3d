-- Per-tenant control-account configuration used by AR/AP posting.
CREATE TABLE fin_ledger_settings (
    tenant_id                            TEXT PRIMARY KEY,
    base_currency                        CHAR(3) NOT NULL,
    ar_control_account_id                TEXT NOT NULL REFERENCES fin_account (id),
    ap_control_account_id                TEXT NOT NULL REFERENCES fin_account (id),
    cash_account_id                      TEXT NOT NULL REFERENCES fin_account (id),
    sales_tax_payable_account_id         TEXT NOT NULL REFERENCES fin_account (id),
    purchase_tax_receivable_account_id   TEXT NOT NULL REFERENCES fin_account (id),
    updated_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox for domain events (drained by integration-hub).
CREATE TABLE fin_event_outbox (
    event_id        TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    aggregate_type  TEXT NOT NULL,
    aggregate_id    TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    payload         JSONB NOT NULL,
    correlation_id  TEXT,
    causation_id    TEXT,
    published_at    TIMESTAMPTZ
);

CREATE INDEX idx_fin_outbox_unpublished ON fin_event_outbox (occurred_at) WHERE published_at IS NULL;
CREATE INDEX idx_fin_outbox_tenant_type ON fin_event_outbox (tenant_id, event_type);
