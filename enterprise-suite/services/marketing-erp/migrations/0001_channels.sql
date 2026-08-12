-- Marketing channels: where campaigns run and spend lands.
CREATE TABLE IF NOT EXISTS mkt_channels (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    code            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN (
                        'email', 'sms', 'paid_search', 'paid_social', 'organic_social',
                        'display', 'affiliate', 'event', 'webinar', 'referral', 'direct_mail')),
    cost_model      TEXT NOT NULL CHECK (cost_model IN ('cpc', 'cpm', 'cpa', 'flat')),
    unit_cost_minor BIGINT NOT NULL CHECK (unit_cost_minor >= 0),
    currency        CHAR(3) NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_mkt_channels_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS ix_mkt_channels_tenant ON mkt_channels (tenant_id);
CREATE INDEX IF NOT EXISTS ix_mkt_channels_kind ON mkt_channels (tenant_id, kind) WHERE active;
