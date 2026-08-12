-- Campaigns and their channel assignments.
CREATE TABLE IF NOT EXISTS mkt_campaigns (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    name          TEXT NOT NULL,
    code          TEXT NOT NULL,
    objective     TEXT NOT NULL CHECK (objective IN (
                      'awareness', 'acquisition', 'activation', 'retention', 'upsell', 'winback')),
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                      'draft', 'scheduled', 'active', 'paused', 'completed', 'archived')),
    starts_at     TIMESTAMPTZ,
    ends_at       TIMESTAMPTZ,
    -- utm_campaign is the campaign code by convention; source/medium defaults below.
    utm_source    TEXT,
    utm_medium    TEXT,
    utm_term      TEXT,
    utm_content   TEXT,
    description   TEXT,
    owner_user_id TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_mkt_campaigns_code UNIQUE (tenant_id, code),
    CONSTRAINT ck_mkt_campaigns_window CHECK (ends_at IS NULL OR starts_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS ix_mkt_campaigns_tenant_status ON mkt_campaigns (tenant_id, status);

CREATE TABLE IF NOT EXISTS mkt_campaign_channels (
    campaign_id TEXT NOT NULL REFERENCES mkt_campaigns (id) ON DELETE CASCADE,
    channel_id  TEXT NOT NULL REFERENCES mkt_channels (id),
    attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, channel_id)
);

CREATE TABLE IF NOT EXISTS mkt_campaign_segments (
    campaign_id TEXT NOT NULL REFERENCES mkt_campaigns (id) ON DELETE CASCADE,
    segment_id  TEXT NOT NULL,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, segment_id)
);
