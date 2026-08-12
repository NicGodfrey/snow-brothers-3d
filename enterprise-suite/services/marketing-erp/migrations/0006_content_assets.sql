-- Content assets with review workflow and revision history.
CREATE TABLE IF NOT EXISTS mkt_content_assets (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN (
                    'email_template', 'sms_template', 'landing_page', 'blog_post',
                    'whitepaper', 'ad_creative', 'social_post', 'video')),
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'retired')),
    body        TEXT NOT NULL,
    subject     TEXT,
    locale      TEXT NOT NULL DEFAULT 'en-US',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_mkt_content_slug UNIQUE (tenant_id, slug),
    CONSTRAINT ck_mkt_content_email_subject CHECK (kind <> 'email_template' OR subject IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_mkt_content_tenant_kind ON mkt_content_assets (tenant_id, kind, status);

CREATE TABLE IF NOT EXISTS mkt_content_revisions (
    asset_id    TEXT NOT NULL REFERENCES mkt_content_assets (id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL,
    body        TEXT NOT NULL,
    subject     TEXT,
    changed_at  TIMESTAMPTZ NOT NULL,
    change_note TEXT,
    PRIMARY KEY (asset_id, revision, changed_at)
);
