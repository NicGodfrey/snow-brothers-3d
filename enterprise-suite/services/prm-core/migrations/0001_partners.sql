-- PRM core: the partner master.
--
-- prm-core owns the partner record of truth; every table here is prefixed
-- `prmc_` so it can share a database with channel-prm's `prm_*` projection
-- without colliding.
--
-- Money is always (amount_minor BIGINT, currency CHAR(3)) in the same shape as
-- the shared-kernel Money value object; nothing stores floats.

-- Per-tenant counters behind PRT-/PCT-/MDF-/CLM- document numbers.
CREATE TABLE prmc_sequences (
    tenant_id  TEXT   NOT NULL,
    key        TEXT   NOT NULL,
    next_value BIGINT NOT NULL DEFAULT 1 CHECK (next_value >= 1),
    PRIMARY KEY (tenant_id, key)
);

CREATE TABLE prmc_partners (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    number                   TEXT        NOT NULL CHECK (number ~ '^PRT-[0-9]{5,}$'),
    legal_name               TEXT        NOT NULL CHECK (length(legal_name) >= 2),
    display_name             TEXT        NOT NULL CHECK (length(display_name) >= 1),
    type                     TEXT        NOT NULL CHECK (type IN (
        'reseller', 'distributor', 'var', 'systems_integrator', 'isv', 'referral', 'msp')),
    status                   TEXT        NOT NULL DEFAULT 'prospect' CHECK (status IN (
        'prospect', 'applied', 'in_review', 'approved', 'active', 'suspended', 'rejected', 'terminated')),
    country_code             CHAR(2)     NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    currency                 CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- Tier-2 partners sit under a distributor; a distributor has no parent.
    parent_partner_id        TEXT        REFERENCES prmc_partners (id) ON DELETE RESTRICT,
    website_url              TEXT        CHECK (website_url IS NULL OR website_url ~ '^https?://'),
    tax_id                   TEXT,
    channel_manager_id       TEXT,
    tier_code                TEXT,
    tier_rank                INTEGER     NOT NULL DEFAULT 0 CHECK (tier_rank >= 0),
    tier_assigned_at         TIMESTAMPTZ,
    territories              TEXT[]      NOT NULL DEFAULT '{}',
    specializations          TEXT[]      NOT NULL DEFAULT '{}',
    application_submitted_at TIMESTAMPTZ,
    review_started_at        TIMESTAMPTZ,
    decided_at               TIMESTAMPTZ,
    decided_by               TEXT,
    decision_notes           TEXT,
    activated_at             TIMESTAMPTZ,
    suspended_at             TIMESTAMPTZ,
    suspension_reason        TEXT,
    terminated_at            TIMESTAMPTZ,
    termination_reason       TEXT,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    UNIQUE (tenant_id, legal_name),
    CHECK (type <> 'distributor' OR parent_partner_id IS NULL),
    CHECK (parent_partner_id IS NULL OR parent_partner_id <> id),
    -- The state machine leaves a trail: every state past the application has
    -- its timestamp, and every adverse decision has to say why.
    CHECK (status IN ('prospect') OR application_submitted_at IS NOT NULL),
    CHECK (status <> 'in_review' OR review_started_at IS NOT NULL),
    CHECK (status NOT IN ('approved', 'rejected') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
    CHECK (status <> 'rejected' OR decision_notes IS NOT NULL),
    CHECK (status NOT IN ('active', 'suspended') OR activated_at IS NOT NULL),
    CHECK (status <> 'suspended' OR (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)),
    CHECK (status <> 'terminated' OR (terminated_at IS NOT NULL AND termination_reason IS NOT NULL)),
    -- A terminated partner drops out of the tier program entirely.
    CHECK (status <> 'terminated' OR (tier_code IS NULL AND tier_rank = 0)),
    CHECK ((tier_code IS NULL) = (tier_assigned_at IS NULL)),
    CHECK (tier_code IS NOT NULL OR tier_rank = 0)
);
CREATE INDEX prmc_partners_tenant_status_idx ON prmc_partners (tenant_id, status);
CREATE INDEX prmc_partners_tenant_tier_idx   ON prmc_partners (tenant_id, tier_rank DESC);
CREATE INDEX prmc_partners_parent_idx        ON prmc_partners (tenant_id, parent_partner_id)
    WHERE parent_partner_id IS NOT NULL;
CREATE INDEX prmc_partners_territories_idx   ON prmc_partners USING GIN (territories);

CREATE TABLE prmc_partner_contacts (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    partner_id TEXT NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    first_name TEXT NOT NULL CHECK (length(first_name) >= 1),
    last_name  TEXT NOT NULL CHECK (length(last_name) >= 1),
    email      TEXT NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    phone      TEXT,
    role       TEXT NOT NULL CHECK (role IN ('primary', 'billing', 'technical', 'marketing', 'executive')),
    job_title  TEXT,
    -- Contact emails are unique inside a partner, not across the tenant: the
    -- same person can be listed by two partners they work with.
    UNIQUE (partner_id, email)
);
-- At most one primary contact per partner.
CREATE UNIQUE INDEX prmc_partner_contacts_primary_idx
    ON prmc_partner_contacts (partner_id) WHERE role = 'primary';

CREATE TABLE prmc_partner_addresses (
    id           TEXT    PRIMARY KEY,
    tenant_id    TEXT    NOT NULL,
    partner_id   TEXT    NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL CHECK (kind IN ('headquarters', 'billing', 'shipping')),
    line1        TEXT    NOT NULL CHECK (length(line1) >= 1),
    line2        TEXT,
    city         TEXT    NOT NULL CHECK (length(city) >= 1),
    region       TEXT,
    postal_code  TEXT    NOT NULL CHECK (length(postal_code) >= 1),
    country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX prmc_partner_addresses_hq_idx
    ON prmc_partner_addresses (partner_id) WHERE kind = 'headquarters';
CREATE INDEX prmc_partner_addresses_partner_idx ON prmc_partner_addresses (partner_id);

-- Append-only audit trail of tier moves; prmc_partners.tier_code is the head.
CREATE TABLE prmc_partner_tier_assignments (
    id           BIGSERIAL   PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    partner_id   TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    tier_code    TEXT        NOT NULL,
    rank         INTEGER     NOT NULL CHECK (rank >= 0),
    direction    TEXT        NOT NULL CHECK (direction IN ('initial', 'upgrade', 'downgrade')),
    reason       TEXT        NOT NULL CHECK (length(reason) >= 1),
    effective_at TIMESTAMPTZ NOT NULL,
    assigned_by  TEXT        NOT NULL
);
CREATE INDEX prmc_partner_tier_assignments_partner_idx
    ON prmc_partner_tier_assignments (partner_id, effective_at DESC);

-- Sales performance per fiscal period; the input to tier evaluation.
CREATE TABLE prmc_partner_performance (
    id                    TEXT        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    partner_id            TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    period                TEXT        NOT NULL CHECK (period ~ '^FY[0-9]{2}-Q[1-4]$'),
    period_start          TIMESTAMPTZ NOT NULL,
    period_end            TIMESTAMPTZ NOT NULL,
    booked_revenue_minor  BIGINT      NOT NULL CHECK (booked_revenue_minor >= 0),
    currency              CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    deals_registered      INTEGER     NOT NULL DEFAULT 0 CHECK (deals_registered >= 0),
    deals_won             INTEGER     NOT NULL DEFAULT 0 CHECK (deals_won >= 0),
    new_logos             INTEGER     NOT NULL DEFAULT 0 CHECK (new_logos >= 0),
    source                TEXT        NOT NULL CHECK (source IN ('sales_erp', 'channel_prm', 'manual', 'import')),
    recorded_at           TIMESTAMPTZ NOT NULL,
    -- Re-stating a period replaces the row rather than adding a second one.
    UNIQUE (tenant_id, partner_id, period),
    CHECK (period_end > period_start),
    CHECK (deals_won <= deals_registered)
);
CREATE INDEX prmc_partner_performance_partner_idx
    ON prmc_partner_performance (partner_id, period_end DESC);
