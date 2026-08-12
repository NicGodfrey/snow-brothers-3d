-- Campaign budgets and append-only spend ledger.
CREATE TABLE IF NOT EXISTS mkt_campaign_budgets (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    campaign_id           TEXT NOT NULL REFERENCES mkt_campaigns (id),
    total_minor           BIGINT NOT NULL CHECK (total_minor > 0),
    currency              CHAR(3) NOT NULL,
    warn_threshold        NUMERIC(3, 2) NOT NULL DEFAULT 0.80
                              CHECK (warn_threshold > 0 AND warn_threshold <= 1),
    allow_overspend       BOOLEAN NOT NULL DEFAULT FALSE,
    threshold_breached_at TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    version               INTEGER NOT NULL DEFAULT 1,
    -- One budget per campaign.
    CONSTRAINT uq_mkt_budgets_campaign UNIQUE (tenant_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS mkt_spend_entries (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    budget_id    TEXT NOT NULL REFERENCES mkt_campaign_budgets (id) ON DELETE CASCADE,
    channel_id   TEXT REFERENCES mkt_channels (id),
    category     TEXT NOT NULL CHECK (category IN ('media', 'agency', 'content', 'tools', 'events', 'other')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency     CHAR(3) NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL,
    note         TEXT
);

CREATE INDEX IF NOT EXISTS ix_mkt_spend_budget ON mkt_spend_entries (budget_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_mkt_spend_channel ON mkt_spend_entries (tenant_id, channel_id);
