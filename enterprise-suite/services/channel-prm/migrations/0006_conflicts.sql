-- Channel PRM: house accounts, conflict cases and their adjudication.

-- Customers the vendor works directly. A partner registration against one of
-- these is refused rather than adjudicated.
CREATE TABLE prm_house_accounts (
    tenant_id     TEXT NOT NULL,
    customer_key  TEXT NOT NULL,
    reason        TEXT NOT NULL,
    owner_id      TEXT,
    product_lines TEXT[],
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, customer_key)
);

CREATE TABLE prm_conflict_cases (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    number                   TEXT        NOT NULL CHECK (number ~ '^CNF-[0-9]{5,}$'),
    kind                     TEXT        NOT NULL CHECK (kind IN (
        'duplicate_registration', 'partner_vs_partner', 'partner_vs_pending', 'partner_vs_direct')),
    severity                 TEXT        NOT NULL CHECK (severity IN ('blocking', 'advisory')),
    customer_key             TEXT        NOT NULL,
    claimant_registration_id TEXT        NOT NULL REFERENCES prm_deal_registrations (id) ON DELETE CASCADE,
    claimant_partner_id      TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE RESTRICT,
    incumbent_registration_id TEXT REFERENCES prm_deal_registrations (id) ON DELETE SET NULL,
    incumbent_partner_id     TEXT REFERENCES prm_partners (id) ON DELETE SET NULL,
    overlapping_product_lines TEXT[]     NOT NULL,
    overlap_days             SMALLINT    NOT NULL DEFAULT 0,
    status                   TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'under_review', 'resolved', 'withdrawn')),
    recommended_outcome      TEXT        NOT NULL CHECK (recommended_outcome IN (
        'incumbent_upheld', 'claimant_awarded', 'co_sell', 'split', 'both_rejected')),
    recommendation_rationale TEXT        NOT NULL,
    raised_at                TIMESTAMPTZ NOT NULL,
    sla_due_at               TIMESTAMPTZ NOT NULL,
    escalation_level         SMALLINT    NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
    escalated_at             TIMESTAMPTZ,
    reviewer_id              TEXT,
    resolved_at              TIMESTAMPTZ,
    resolved_by              TEXT,
    outcome                  TEXT CHECK (outcome IN (
        'incumbent_upheld', 'claimant_awarded', 'co_sell', 'split', 'both_rejected')),
    rationale                TEXT,
    awarded_registration_id  TEXT REFERENCES prm_deal_registrations (id) ON DELETE SET NULL,
    split_bps                INTEGER CHECK (split_bps BETWEEN 1 AND 9999),
    withdrawn_reason         TEXT,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    -- A resolution needs an outcome, a rationale and an author.
    CHECK (status <> 'resolved' OR (outcome IS NOT NULL AND rationale IS NOT NULL AND resolved_by IS NOT NULL)),
    CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL),
    -- Two-sided outcomes need two sides.
    CHECK (outcome IS NULL
           OR outcome IN ('claimant_awarded', 'both_rejected')
           OR incumbent_registration_id IS NOT NULL),
    CHECK ((outcome = 'split') = (split_bps IS NOT NULL)),
    CHECK (claimant_registration_id <> incumbent_registration_id)
);
CREATE INDEX prm_conflicts_tenant_status_idx ON prm_conflict_cases (tenant_id, status);
CREATE INDEX prm_conflicts_customer_idx ON prm_conflict_cases (tenant_id, customer_key);
CREATE INDEX prm_conflicts_claimant_idx ON prm_conflict_cases (claimant_registration_id);
CREATE INDEX prm_conflicts_incumbent_idx ON prm_conflict_cases (incumbent_registration_id);
CREATE INDEX prm_conflicts_sla_idx
    ON prm_conflict_cases (tenant_id, sla_due_at)
    WHERE status IN ('open', 'under_review');

-- Only one open case per pair of registrations: a partner re-submitting must
-- not be able to flood the adjudication queue.
CREATE UNIQUE INDEX prm_conflicts_open_pair_idx
    ON prm_conflict_cases (claimant_registration_id, incumbent_registration_id)
    WHERE status IN ('open', 'under_review');

CREATE TABLE prm_conflict_evidence (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    conflict_id TEXT        NOT NULL REFERENCES prm_conflict_cases (id) ON DELETE CASCADE,
    at          TIMESTAMPTZ NOT NULL,
    submitted_by TEXT       NOT NULL,
    source      TEXT        NOT NULL CHECK (source IN ('claimant', 'incumbent', 'vendor')),
    note        TEXT        NOT NULL CHECK (length(note) >= 5)
);
CREATE INDEX prm_conflict_evidence_case_idx ON prm_conflict_evidence (conflict_id, at);
