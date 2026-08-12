-- Segments (dynamic rule-based or static curated) and built audiences.
CREATE TABLE IF NOT EXISTS mkt_segments (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('dynamic', 'static')),
    -- Serialized SegmentRule AST; evaluated in the application layer.
    rule        JSONB,
    description TEXT,
    archived    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_mkt_segments_rule CHECK (type <> 'dynamic' OR rule IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_mkt_segments_tenant ON mkt_segments (tenant_id) WHERE NOT archived;

CREATE TABLE IF NOT EXISTS mkt_segment_static_members (
    segment_id TEXT NOT NULL REFERENCES mkt_segments (id) ON DELETE CASCADE,
    lead_id    TEXT NOT NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (segment_id, lead_id)
);

-- An audience is an immutable membership snapshot used by send jobs.
CREATE TABLE IF NOT EXISTS mkt_audiences (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    segment_id   TEXT NOT NULL REFERENCES mkt_segments (id),
    campaign_id  TEXT REFERENCES mkt_campaigns (id),
    channel_kind TEXT NOT NULL CHECK (channel_kind IN ('email', 'sms')),
    built_at     TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mkt_audience_members (
    audience_id TEXT NOT NULL REFERENCES mkt_audiences (id) ON DELETE CASCADE,
    lead_id     TEXT NOT NULL,
    -- NULL reason means the lead is an active member; otherwise why it was suppressed.
    suppressed_reason TEXT CHECK (suppressed_reason IN
        ('unsubscribed', 'bounced', 'disqualified', 'no_consent')),
    PRIMARY KEY (audience_id, lead_id)
);

CREATE INDEX IF NOT EXISTS ix_mkt_audiences_tenant ON mkt_audiences (tenant_id, built_at DESC);
