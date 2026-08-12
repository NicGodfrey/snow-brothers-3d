-- Channel PRM: deal registrations and their protection windows.

CREATE TABLE prm_deal_registrations (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    number               TEXT        NOT NULL CHECK (number ~ '^DR-[0-9]{5,}$'),
    partner_id           TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE RESTRICT,
    -- Tier snapshot at approval: a later tier move must not rewrite history.
    tier_at_approval     TEXT CHECK (tier_at_approval IN ('registered', 'silver', 'gold', 'platinum')),
    customer_name        TEXT        NOT NULL,
    customer_domain      TEXT,
    customer_country     CHAR(2)     NOT NULL CHECK (customer_country ~ '^[A-Z]{2}$'),
    customer_region      TEXT,
    customer_city        TEXT,
    customer_tax_id      TEXT,
    customer_account_ref TEXT,
    -- Resolved identity: 'domain:acme.com' or 'name:acme|DE'. Everything about
    -- protection and conflicts keys off this, so it is stored, not derived.
    customer_key         TEXT        NOT NULL,
    source               TEXT        NOT NULL DEFAULT 'partner_sourced'
        CHECK (source IN ('partner_sourced', 'vendor_referred', 'co_sell')),
    status               TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'under_review', 'approved', 'rejected',
        'withdrawn', 'expired', 'closed_won', 'closed_lost')),
    stage                TEXT        NOT NULL DEFAULT 'qualified' CHECK (stage IN (
        'prospect', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost')),
    probability          SMALLINT    NOT NULL DEFAULT 25 CHECK (probability BETWEEN 0 AND 100),
    estimated_value_minor BIGINT     NOT NULL CHECK (estimated_value_minor > 0),
    currency             CHAR(3)     NOT NULL,
    expected_close_date  TIMESTAMPTZ NOT NULL,
    description          TEXT,
    referral_id          TEXT,
    submitted_at         TIMESTAMPTZ,
    submitted_by         TEXT,
    sla_due_at           TIMESTAMPTZ,
    review_started_at    TIMESTAMPTZ,
    reviewer_id          TEXT,
    approved_at          TIMESTAMPTZ,
    approved_by          TEXT,
    approval_notes       TEXT,
    auto_approved        BOOLEAN     NOT NULL DEFAULT FALSE,
    discount_bps         INTEGER     CHECK (discount_bps BETWEEN 0 AND 10000),
    protection_starts_at TIMESTAMPTZ,
    protection_ends_at   TIMESTAMPTZ,
    protection_granted_days SMALLINT,
    rejected_at          TIMESTAMPTZ,
    rejected_by          TEXT,
    rejection_reason     TEXT CHECK (rejection_reason IN (
        'duplicate', 'house_account', 'insufficient_detail', 'out_of_territory',
        'unauthorized_product_line', 'existing_pipeline', 'conflict_lost', 'partner_ineligible')),
    rejection_notes      TEXT,
    withdrawn_reason     TEXT,
    expired_at           TIMESTAMPTZ,
    expiry_warned_at     TIMESTAMPTZ,
    closed_at            TIMESTAMPTZ,
    closed_by            TEXT,
    closed_value_minor   BIGINT,
    loss_reason          TEXT CHECK (loss_reason IN (
        'price', 'competitor', 'no_decision', 'timing', 'requirements', 'budget', 'other')),
    competitor           TEXT,
    version              INTEGER     NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (status NOT IN ('submitted', 'under_review', 'approved', 'rejected', 'expired', 'closed_won', 'closed_lost')
           OR submitted_at IS NOT NULL),
    -- Approval is what mints protection: the three columns move together.
    CHECK ((protection_starts_at IS NULL) = (protection_ends_at IS NULL)),
    CHECK (protection_ends_at IS NULL OR protection_ends_at >= protection_starts_at),
    CHECK (status NOT IN ('approved', 'expired') OR protection_starts_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL),
    CHECK (status NOT IN ('closed_won', 'closed_lost') OR closed_at IS NOT NULL),
    CHECK (status <> 'closed_lost' OR loss_reason IS NOT NULL),
    CHECK (loss_reason <> 'competitor' OR competitor IS NOT NULL),
    CHECK (stage IN ('closed_won', 'closed_lost') = (status IN ('closed_won', 'closed_lost')))
);

CREATE INDEX prm_registrations_tenant_status_idx
    ON prm_deal_registrations (tenant_id, status);
CREATE INDEX prm_registrations_partner_idx
    ON prm_deal_registrations (tenant_id, partner_id, status);
-- The conflict detector's primary lookup.
CREATE INDEX prm_registrations_customer_idx
    ON prm_deal_registrations (tenant_id, customer_key);
-- Expiry sweep and the protection-expiry report scan only live protection.
CREATE INDEX prm_registrations_protection_idx
    ON prm_deal_registrations (tenant_id, protection_ends_at)
    WHERE status = 'approved';
CREATE INDEX prm_registrations_sla_idx
    ON prm_deal_registrations (tenant_id, sla_due_at)
    WHERE status IN ('submitted', 'under_review');

-- Product lines are the second half of the protected space: two registrations
-- only collide when they share a customer *and* a line.
CREATE TABLE prm_registration_product_lines (
    tenant_id       TEXT NOT NULL,
    registration_id TEXT NOT NULL REFERENCES prm_deal_registrations (id) ON DELETE CASCADE,
    product_line    TEXT NOT NULL,
    PRIMARY KEY (registration_id, product_line)
);
CREATE INDEX prm_registration_lines_lookup_idx
    ON prm_registration_product_lines (tenant_id, product_line);

CREATE TABLE prm_registration_competitors (
    registration_id TEXT NOT NULL REFERENCES prm_deal_registrations (id) ON DELETE CASCADE,
    competitor      TEXT NOT NULL,
    PRIMARY KEY (registration_id, competitor)
);

-- Extensions never overwrite the original grant; the audit trail is what a
-- partner disputing an expiry date is shown.
CREATE TABLE prm_protection_extensions (
    id               TEXT        PRIMARY KEY,
    tenant_id        TEXT        NOT NULL,
    registration_id  TEXT        NOT NULL REFERENCES prm_deal_registrations (id) ON DELETE CASCADE,
    days             SMALLINT    NOT NULL CHECK (days > 0),
    reason           TEXT        NOT NULL,
    granted_by       TEXT        NOT NULL,
    granted_at       TIMESTAMPTZ NOT NULL,
    previous_ends_at TIMESTAMPTZ NOT NULL,
    new_ends_at      TIMESTAMPTZ NOT NULL,
    CHECK (new_ends_at > previous_ends_at)
);
CREATE INDEX prm_protection_extensions_reg_idx
    ON prm_protection_extensions (registration_id, granted_at);

CREATE TABLE prm_registration_timeline (
    id              BIGSERIAL   PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    registration_id TEXT        NOT NULL REFERENCES prm_deal_registrations (id) ON DELETE CASCADE,
    at              TIMESTAMPTZ NOT NULL,
    actor           TEXT        NOT NULL,
    action          TEXT        NOT NULL,
    detail          TEXT
);
CREATE INDEX prm_registration_timeline_reg_idx
    ON prm_registration_timeline (registration_id, at);
