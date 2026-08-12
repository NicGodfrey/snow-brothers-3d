-- Email/SMS send jobs and per-recipient delivery records.
CREATE TABLE IF NOT EXISTS mkt_send_jobs (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    campaign_id      TEXT NOT NULL REFERENCES mkt_campaigns (id),
    channel_id       TEXT NOT NULL REFERENCES mkt_channels (id),
    channel_kind     TEXT NOT NULL CHECK (channel_kind IN ('email', 'sms')),
    audience_id      TEXT NOT NULL REFERENCES mkt_audiences (id),
    content_asset_id TEXT NOT NULL REFERENCES mkt_content_assets (id),
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                         'draft', 'queued', 'running', 'completed', 'failed', 'cancelled')),
    scheduled_at     TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    failure_reason   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_mkt_send_jobs_campaign ON mkt_send_jobs (tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS ix_mkt_send_jobs_due
    ON mkt_send_jobs (scheduled_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS mkt_send_recipients (
    job_id       TEXT NOT NULL REFERENCES mkt_send_jobs (id) ON DELETE CASCADE,
    lead_id      TEXT NOT NULL REFERENCES mkt_leads (id),
    address      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                     'pending', 'skipped_no_consent', 'skipped_no_address', 'sent', 'bounced')),
    opened       BOOLEAN NOT NULL DEFAULT FALSE,
    clicked      BOOLEAN NOT NULL DEFAULT FALSE,
    unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at      TIMESTAMPTZ,
    error        TEXT,
    PRIMARY KEY (job_id, lead_id)
);

CREATE INDEX IF NOT EXISTS ix_mkt_send_recipients_lead ON mkt_send_recipients (lead_id);
