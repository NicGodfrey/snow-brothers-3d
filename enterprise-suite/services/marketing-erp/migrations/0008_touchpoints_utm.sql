-- Attribution touchpoints (append-only) and UTM tracked links.
CREATE TABLE IF NOT EXISTS mkt_touchpoints (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    lead_id      TEXT NOT NULL REFERENCES mkt_leads (id) ON DELETE CASCADE,
    touch_type   TEXT NOT NULL CHECK (touch_type IN (
                     'impression', 'click', 'visit', 'form_submit', 'email_open',
                     'email_click', 'sms_click', 'webinar_attend', 'event_checkin', 'referral_visit')),
    occurred_at  TIMESTAMPTZ NOT NULL,
    campaign_id  TEXT REFERENCES mkt_campaigns (id),
    channel_id   TEXT REFERENCES mkt_channels (id),
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    utm_term     TEXT,
    utm_content  TEXT,
    source_ref   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A touchpoint must be attributable to something.
    CONSTRAINT ck_mkt_touchpoints_attributable CHECK (
        campaign_id IS NOT NULL OR channel_id IS NOT NULL OR utm_campaign IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_mkt_touchpoints_lead ON mkt_touchpoints (tenant_id, lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_mkt_touchpoints_campaign ON mkt_touchpoints (tenant_id, campaign_id, occurred_at);

CREATE TABLE IF NOT EXISTS mkt_tracked_links (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    short_code      TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    utm_source      TEXT NOT NULL,
    utm_medium      TEXT NOT NULL,
    utm_campaign    TEXT NOT NULL,
    utm_term        TEXT,
    utm_content     TEXT,
    campaign_id     TEXT REFERENCES mkt_campaigns (id),
    channel_id      TEXT REFERENCES mkt_channels (id),
    click_count     BIGINT NOT NULL DEFAULT 0,
    last_clicked_at TIMESTAMPTZ,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_mkt_tracked_links_code UNIQUE (tenant_id, short_code)
);
