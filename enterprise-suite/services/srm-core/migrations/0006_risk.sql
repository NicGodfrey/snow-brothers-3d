-- SRM core: the supplier risk register and the compliance holds that stop
-- trade. Holds are what other bounded contexts read before sourcing, issuing
-- a purchase order or paying an invoice.

CREATE TABLE srm_risk_profiles (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    supplier_id       TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    supplier_code     TEXT        NOT NULL,
    -- Derived from the open flags; stored so the heatmap is a single scan.
    tier              TEXT        NOT NULL DEFAULT 'low'
        CHECK (tier IN ('low', 'medium', 'high', 'critical')),
    score             SMALLINT    NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 25),
    last_reviewed_on  DATE,
    version           INTEGER     NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL,
    -- One register per supplier, created at registration.
    UNIQUE (supplier_id)
);
CREATE INDEX srm_risk_profiles_tier_idx ON srm_risk_profiles (tenant_id, tier, score DESC);

CREATE TABLE srm_risk_flags (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    profile_id           TEXT        NOT NULL REFERENCES srm_risk_profiles (id) ON DELETE CASCADE,
    category             TEXT        NOT NULL CHECK (category IN (
        'financial', 'operational', 'geopolitical', 'cyber', 'esg', 'quality',
        'delivery', 'single_source', 'sanctions', 'labor', 'data_privacy', 'regulatory')),
    title                TEXT        NOT NULL,
    description          TEXT,
    source               TEXT        NOT NULL CHECK (source IN (
        'monitoring', 'audit', 'questionnaire', 'news', 'internal', 'supplier_disclosed')),
    likelihood           SMALLINT    NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
    impact               SMALLINT    NOT NULL CHECK (impact BETWEEN 1 AND 5),
    inherent_score       SMALLINT    NOT NULL CHECK (inherent_score BETWEEN 1 AND 25),
    severity             TEXT        NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status               TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'mitigating', 'accepted', 'closed')),
    detected_on          DATE        NOT NULL,
    review_due_on        DATE,
    owner_id             TEXT,
    mitigation_plan      TEXT,
    mitigation_owner_id  TEXT,
    mitigation_due_on    DATE,
    residual_likelihood  SMALLINT    CHECK (residual_likelihood BETWEEN 1 AND 5),
    residual_impact      SMALLINT    CHECK (residual_impact BETWEEN 1 AND 5),
    residual_score       SMALLINT    CHECK (residual_score BETWEEN 1 AND 25),
    accepted_by          TEXT,
    accepted_reason      TEXT,
    closed_on            DATE,
    closed_reason        TEXT,
    -- Correlates an automatically raised flag with the fact that caused it,
    -- e.g. "qualification:<id>" or "scorecard:<id>".
    source_ref           TEXT,
    raised_at            TIMESTAMPTZ NOT NULL,
    CHECK (inherent_score = likelihood * impact),
    -- Mitigation can only lower the score, never raise it.
    CHECK (residual_score IS NULL OR residual_score <= inherent_score),
    CHECK (status <> 'mitigating' OR mitigation_plan IS NOT NULL),
    CHECK (status <> 'accepted' OR (accepted_by IS NOT NULL AND accepted_reason IS NOT NULL)),
    -- A critical risk must be mitigated or closed; it cannot be signed away.
    CHECK (status <> 'accepted' OR severity <> 'critical'),
    CHECK (status <> 'closed' OR (closed_on IS NOT NULL AND closed_reason IS NOT NULL))
);
CREATE INDEX srm_risk_flags_open_idx
    ON srm_risk_flags (tenant_id, review_due_on)
    WHERE status IN ('open', 'mitigating');
CREATE INDEX srm_risk_flags_source_idx ON srm_risk_flags (profile_id, source_ref);

CREATE TABLE srm_compliance_holds (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    profile_id      TEXT        NOT NULL REFERENCES srm_risk_profiles (id) ON DELETE CASCADE,
    supplier_id     TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    type            TEXT        NOT NULL CHECK (type IN (
        'sourcing', 'purchase_order', 'payment', 'onboarding', 'shipment')),
    reason_code     TEXT        NOT NULL CHECK (reason_code IN (
        'sanctions_match', 'expired_certification', 'failed_audit', 'missing_tax_form',
        'unverified_bank_details', 'litigation', 'quality_incident', 'credit_risk',
        'esg_violation', 'data_breach', 'contract_expired', 'performance_probation')),
    scope           TEXT        NOT NULL DEFAULT 'supplier'
        CHECK (scope IN ('supplier', 'categories', 'sites')),
    category_ids    TEXT[]      NOT NULL DEFAULT '{}',
    site_ids        TEXT[]      NOT NULL DEFAULT '{}',
    note            TEXT,
    status          TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'released', 'expired')),
    placed_by       TEXT        NOT NULL,
    placed_at       TIMESTAMPTZ NOT NULL,
    placed_on       DATE        NOT NULL,
    expires_on      DATE,
    -- Roles allowed to release; empty means any authenticated user.
    release_roles   TEXT[]      NOT NULL DEFAULT '{}',
    released_by     TEXT,
    released_on     DATE,
    release_reason  TEXT,
    source_ref      TEXT,
    CHECK (scope <> 'categories' OR array_length(category_ids, 1) >= 1),
    CHECK (scope <> 'sites' OR array_length(site_ids, 1) >= 1),
    CHECK (expires_on IS NULL OR expires_on >= placed_on),
    CHECK (status <> 'released'
        OR (released_by IS NOT NULL AND released_on IS NOT NULL AND release_reason IS NOT NULL))
);
-- The clearance check for another bounded context is a single index hit.
CREATE INDEX srm_compliance_holds_active_idx
    ON srm_compliance_holds (tenant_id, supplier_id, type)
    WHERE status = 'active';
-- One live hold per (type, reason, source) so an automatic rule that fires
-- repeatedly cannot stack duplicates.
CREATE UNIQUE INDEX srm_compliance_holds_source_idx
    ON srm_compliance_holds (supplier_id, type, reason_code, source_ref)
    WHERE status = 'active' AND source_ref IS NOT NULL;
