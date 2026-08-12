-- Leads, their activity stream, and consent state.
CREATE TABLE IF NOT EXISTS mkt_leads (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    email                 TEXT NOT NULL,
    first_name            TEXT,
    last_name             TEXT,
    phone                 TEXT,
    company               TEXT,
    job_title             TEXT,
    industry              TEXT,
    company_size          INTEGER CHECK (company_size IS NULL OR company_size > 0),
    country               CHAR(2),
    source                TEXT NOT NULL CHECK (source IN (
                              'web_form', 'landing_page', 'import', 'event', 'webinar',
                              'referral', 'paid', 'organic', 'outbound', 'partner')),
    stage                 TEXT NOT NULL DEFAULT 'subscriber' CHECK (stage IN (
                              'subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer', 'disqualified')),
    score                 INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    grade                 CHAR(1) NOT NULL DEFAULT 'D' CHECK (grade IN ('A', 'B', 'C', 'D')),
    tags                  TEXT[] NOT NULL DEFAULT '{}',
    consent_email         BOOLEAN NOT NULL DEFAULT FALSE,
    consent_sms           BOOLEAN NOT NULL DEFAULT FALSE,
    consent_updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    captured_utm          JSONB,
    disqualified_reason   TEXT,
    last_activity_at      TIMESTAMPTZ,
    owner_user_id         TEXT,
    conversion_value_minor BIGINT CHECK (conversion_value_minor IS NULL OR conversion_value_minor > 0),
    conversion_currency   CHAR(3),
    converted_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    version               INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_mkt_leads_email UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS ix_mkt_leads_tenant_stage ON mkt_leads (tenant_id, stage);
CREATE INDEX IF NOT EXISTS ix_mkt_leads_tenant_score ON mkt_leads (tenant_id, score DESC);
CREATE INDEX IF NOT EXISTS ix_mkt_leads_tags ON mkt_leads USING gin (tags);

CREATE TABLE IF NOT EXISTS mkt_lead_activities (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    lead_id      TEXT NOT NULL REFERENCES mkt_leads (id) ON DELETE CASCADE,
    type         TEXT NOT NULL CHECK (type IN (
                     'page_view', 'form_submit', 'email_open', 'email_click', 'sms_click',
                     'webinar_attend', 'event_checkin', 'demo_request', 'content_download',
                     'pricing_view', 'trial_signup')),
    occurred_at  TIMESTAMPTZ NOT NULL,
    campaign_id  TEXT REFERENCES mkt_campaigns (id),
    channel_id   TEXT REFERENCES mkt_channels (id),
    metadata     JSONB
);

CREATE INDEX IF NOT EXISTS ix_mkt_lead_activities_lead ON mkt_lead_activities (lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_mkt_lead_activities_campaign ON mkt_lead_activities (tenant_id, campaign_id);
