-- Channel PRM: opportunity referrals, attribution windows and commission.

CREATE TABLE prm_referrals (
    id                 TEXT        PRIMARY KEY,
    tenant_id          TEXT        NOT NULL,
    number             TEXT        NOT NULL CHECK (number ~ '^REF-[0-9]{5,}$'),
    partner_id         TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE RESTRICT,
    contact_name       TEXT        NOT NULL,
    contact_email      TEXT        NOT NULL,
    contact_phone      TEXT,
    contact_title      TEXT,
    company_name       TEXT        NOT NULL,
    company_domain     TEXT,
    company_country    CHAR(2)     NOT NULL,
    company_region     TEXT,
    customer_key       TEXT        NOT NULL,
    estimated_value_minor BIGINT   CHECK (estimated_value_minor IS NULL OR estimated_value_minor > 0),
    currency           CHAR(3),
    notes              TEXT,
    status             TEXT        NOT NULL DEFAULT 'submitted' CHECK (status IN (
        'submitted', 'accepted', 'rejected', 'converted', 'expired', 'closed_won', 'closed_lost')),
    submitted_at       TIMESTAMPTZ NOT NULL,
    -- Vendors owe partners a fast answer; the sweep expires anything past this.
    decision_due_at    TIMESTAMPTZ NOT NULL,
    accepted_at        TIMESTAMPTZ,
    accepted_by        TEXT,
    attribution_starts_at TIMESTAMPTZ,
    attribution_ends_at   TIMESTAMPTZ,
    commission_bps     INTEGER CHECK (commission_bps BETWEEN 0 AND 10000),
    rejected_at        TIMESTAMPTZ,
    rejection_reason   TEXT CHECK (rejection_reason IN (
        'duplicate', 'existing_customer', 'existing_pipeline', 'out_of_scope', 'invalid_contact', 'no_consent')),
    rejection_notes    TEXT,
    converted_at       TIMESTAMPTZ,
    converted_by       TEXT,
    registration_id    TEXT REFERENCES prm_deal_registrations (id) ON DELETE SET NULL,
    opportunity_ref    TEXT,
    outcome_at         TIMESTAMPTZ,
    outcome_by         TEXT,
    outcome_value_minor BIGINT,
    outcome_reason     TEXT,
    expired_at         TIMESTAMPTZ,
    version            INTEGER     NOT NULL DEFAULT 1,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (status <> 'accepted' OR attribution_ends_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    -- A conversion must point somewhere: a registration or an external deal.
    CHECK (status <> 'converted' OR registration_id IS NOT NULL OR opportunity_ref IS NOT NULL),
    CHECK (status <> 'closed_won' OR outcome_value_minor IS NOT NULL),
    CHECK ((attribution_starts_at IS NULL) = (attribution_ends_at IS NULL)),
    CHECK (attribution_ends_at IS NULL OR attribution_ends_at > attribution_starts_at)
);
CREATE INDEX prm_referrals_tenant_status_idx ON prm_referrals (tenant_id, status);
CREATE INDEX prm_referrals_partner_idx ON prm_referrals (tenant_id, partner_id, status);
CREATE INDEX prm_referrals_customer_idx ON prm_referrals (tenant_id, customer_key);
CREATE INDEX prm_referrals_decision_due_idx
    ON prm_referrals (tenant_id, decision_due_at)
    WHERE status = 'submitted';
CREATE INDEX prm_referrals_attribution_idx
    ON prm_referrals (tenant_id, attribution_ends_at)
    WHERE status = 'accepted';

CREATE TABLE prm_referral_product_lines (
    tenant_id    TEXT NOT NULL,
    referral_id  TEXT NOT NULL REFERENCES prm_referrals (id) ON DELETE CASCADE,
    product_line TEXT NOT NULL,
    PRIMARY KEY (referral_id, product_line)
);

-- Commission is a liability with its own lifecycle: accruing it is not paying
-- it, and finance approves before any payment run picks it up.
CREATE TABLE prm_referral_commissions (
    referral_id   TEXT        PRIMARY KEY REFERENCES prm_referrals (id) ON DELETE CASCADE,
    tenant_id     TEXT        NOT NULL,
    partner_id    TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE RESTRICT,
    bps           INTEGER     NOT NULL CHECK (bps BETWEEN 0 AND 10000),
    basis_minor   BIGINT      NOT NULL CHECK (basis_minor >= 0),
    amount_minor  BIGINT      NOT NULL CHECK (amount_minor >= 0),
    currency      CHAR(3)     NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('none', 'accrued', 'approved', 'paid', 'void')),
    accrued_at    TIMESTAMPTZ,
    approved_at   TIMESTAMPTZ,
    approved_by   TEXT,
    paid_at       TIMESTAMPTZ,
    payment_ref   TEXT,
    CHECK (status <> 'accrued' OR accrued_at IS NOT NULL),
    CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
    CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND payment_ref IS NOT NULL)),
    CHECK (amount_minor <= basis_minor)
);
CREATE INDEX prm_referral_commissions_partner_idx
    ON prm_referral_commissions (tenant_id, partner_id, status);

CREATE TABLE prm_referral_timeline (
    id          BIGSERIAL   PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    referral_id TEXT        NOT NULL REFERENCES prm_referrals (id) ON DELETE CASCADE,
    at          TIMESTAMPTZ NOT NULL,
    actor       TEXT        NOT NULL,
    action      TEXT        NOT NULL,
    detail      TEXT
);
CREATE INDEX prm_referral_timeline_ref_idx ON prm_referral_timeline (referral_id, at);
