-- Channel PRM: partner profiles and tier policy.
--
-- The partner master lives in prm-core; this is the channel's own projection,
-- fed by prm.partner.* events and authoritative for channel eligibility only.

CREATE TABLE prm_partners (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    code                TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'),
    name                TEXT        NOT NULL CHECK (length(name) >= 2),
    tier                TEXT        NOT NULL DEFAULT 'registered'
        CHECK (tier IN ('registered', 'silver', 'gold', 'platinum')),
    type                TEXT        NOT NULL CHECK (type IN (
        'reseller', 'distributor', 'referral_agent', 'msp', 'system_integrator', 'isv')),
    status              TEXT        NOT NULL DEFAULT 'onboarding'
        CHECK (status IN ('onboarding', 'active', 'suspended', 'terminated')),
    currency            CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    contact_name        TEXT        NOT NULL,
    contact_email       TEXT        NOT NULL CHECK (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    contact_phone       TEXT,
    channel_manager_id  TEXT,
    onboarded_at        TIMESTAMPTZ,
    status_reason       TEXT,
    tier_changed_at     TIMESTAMPTZ,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    -- Suspension and termination must say why; the partner is told.
    CHECK (status NOT IN ('suspended', 'terminated') OR status_reason IS NOT NULL),
    CHECK (status <> 'active' OR onboarded_at IS NOT NULL)
);
CREATE INDEX prm_partners_tenant_status_idx ON prm_partners (tenant_id, status);
CREATE INDEX prm_partners_tenant_tier_idx ON prm_partners (tenant_id, tier);

-- Territory grants: '*' (global), a region code (EMEA, NA, APAC, LATAM) or an
-- ISO 3166-1 alpha-2 country code.
CREATE TABLE prm_partner_territories (
    tenant_id  TEXT NOT NULL,
    partner_id TEXT NOT NULL REFERENCES prm_partners (id) ON DELETE CASCADE,
    territory  TEXT NOT NULL CHECK (territory = '*' OR territory ~ '^[A-Z]{2,5}$'),
    PRIMARY KEY (partner_id, territory)
);

CREATE TABLE prm_partner_product_lines (
    tenant_id    TEXT NOT NULL,
    partner_id   TEXT NOT NULL REFERENCES prm_partners (id) ON DELETE CASCADE,
    product_line TEXT NOT NULL CHECK (product_line ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    PRIMARY KEY (partner_id, product_line)
);
CREATE INDEX prm_partner_product_lines_line_idx
    ON prm_partner_product_lines (tenant_id, product_line);

-- Per-tenant override of the shipped tier defaults. A missing row means the
-- application default applies, so a tenant only stores what it changed.
CREATE TABLE prm_tier_policies (
    tenant_id                TEXT     NOT NULL,
    tier                     TEXT     NOT NULL
        CHECK (tier IN ('registered', 'silver', 'gold', 'platinum')),
    protection_days          SMALLINT NOT NULL CHECK (protection_days BETWEEN 1 AND 365),
    max_extension_days       SMALLINT NOT NULL CHECK (max_extension_days BETWEEN 0 AND 180),
    max_extensions           SMALLINT NOT NULL CHECK (max_extensions BETWEEN 0 AND 6),
    approval_sla_hours       SMALLINT NOT NULL CHECK (approval_sla_hours > 0),
    base_discount_bps        INTEGER  NOT NULL CHECK (base_discount_bps BETWEEN 0 AND 9000),
    registered_discount_bps  INTEGER  NOT NULL CHECK (registered_discount_bps BETWEEN 0 AND 9000),
    max_discount_bps         INTEGER  NOT NULL CHECK (max_discount_bps BETWEEN 0 AND 9000),
    referral_commission_bps  INTEGER  NOT NULL CHECK (referral_commission_bps BETWEEN 0 AND 5000),
    auto_approve_below_minor BIGINT   NOT NULL CHECK (auto_approve_below_minor >= 0),
    renewal_grace_days       SMALLINT NOT NULL CHECK (renewal_grace_days BETWEEN 0 AND 90),
    conflict_sla_hours       SMALLINT NOT NULL CHECK (conflict_sla_hours > 0),
    PRIMARY KEY (tenant_id, tier),
    -- Registering a deal must be worth more than not registering it, and the
    -- automatic discount must sit inside the approvable band.
    CHECK (base_discount_bps <= registered_discount_bps),
    CHECK (registered_discount_bps <= max_discount_bps)
);
