-- PRM core: market development funds.
--
-- The money moves in three steps and each has its own aggregate:
--
--   budget      pool of funds for a fiscal period, split into per-partner
--               allocations that track amount / committed / paid
--   request     a partner asks for funds up front; approval *commits* money
--               against the allocation and opens a claim window
--   claim       the partner asks to be reimbursed with proof of performance;
--               payment *settles* the committed money
--
-- The ledger invariant committed + paid <= amount is enforced on the allocation
-- row, so no code path can pay out money that was never allocated.

CREATE TABLE prmc_mdf_budgets (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    code              TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,30}$'),
    name              TEXT        NOT NULL CHECK (length(name) >= 1),
    period            TEXT        NOT NULL CHECK (period ~ '^FY[0-9]{2}-Q[1-4]$'),
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    currency          CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status            TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    total_minor       BIGINT      NOT NULL CHECK (total_minor > 0),
    -- Days after the activity ends in which a claim must be filed.
    claim_window_days INTEGER     NOT NULL DEFAULT 60 CHECK (claim_window_days BETWEEN 1 AND 365),
    -- Vendor share of an activity, in basis points (5000 = 50/50 co-funding).
    matching_rate_bps INTEGER     NOT NULL DEFAULT 5000 CHECK (matching_rate_bps BETWEEN 0 AND 10000),
    opened_at         TIMESTAMPTZ,
    closed_at         TIMESTAMPTZ,
    closed_by         TEXT,
    version           INTEGER     NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    CHECK (period_end > period_start),
    CHECK (status = 'draft' OR opened_at IS NOT NULL),
    CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
CREATE INDEX prmc_mdf_budgets_period_idx ON prmc_mdf_budgets (tenant_id, period, status);

CREATE TABLE prmc_mdf_allocations (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    budget_id      TEXT        NOT NULL REFERENCES prmc_mdf_budgets (id) ON DELETE CASCADE,
    partner_id     TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE RESTRICT,
    amount_minor   BIGINT      NOT NULL CHECK (amount_minor >= 0),
    -- Approved but not yet paid out.
    committed_minor BIGINT     NOT NULL DEFAULT 0 CHECK (committed_minor >= 0),
    paid_minor     BIGINT      NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    allocated_at   TIMESTAMPTZ NOT NULL,
    note           TEXT,
    -- A partner gets one allocation per budget; top it up rather than adding a second.
    UNIQUE (budget_id, partner_id),
    -- Paying a claim moves money from committed to paid, so the two buckets are
    -- disjoint and together they can never exceed what was allocated.
    CHECK (committed_minor + paid_minor <= amount_minor)
);
CREATE INDEX prmc_mdf_allocations_partner_idx ON prmc_mdf_allocations (tenant_id, partner_id);

CREATE TABLE prmc_mdf_requests (
    id                        TEXT        PRIMARY KEY,
    tenant_id                 TEXT        NOT NULL,
    number                    TEXT        NOT NULL CHECK (number ~ '^MDF-[0-9]{5,}$'),
    partner_id                TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE RESTRICT,
    budget_id                 TEXT        NOT NULL REFERENCES prmc_mdf_budgets (id) ON DELETE RESTRICT,
    allocation_id             TEXT        NOT NULL REFERENCES prmc_mdf_allocations (id) ON DELETE RESTRICT,
    activity_type             TEXT        NOT NULL CHECK (activity_type IN (
        'event', 'trade_show', 'digital_campaign', 'content_syndication',
        'telemarketing', 'training', 'demo_equipment', 'market_research')),
    title                     TEXT        NOT NULL CHECK (length(title) >= 3),
    description               TEXT        NOT NULL CHECK (length(description) >= 10),
    activity_start            TIMESTAMPTZ NOT NULL,
    activity_end              TIMESTAMPTZ NOT NULL,
    currency                  CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    requested_amount_minor    BIGINT      NOT NULL CHECK (requested_amount_minor > 0),
    -- The partner's own share under the budget's matching rate.
    partner_contribution_minor BIGINT     NOT NULL DEFAULT 0 CHECK (partner_contribution_minor >= 0),
    expected_leads            INTEGER     NOT NULL DEFAULT 0 CHECK (expected_leads >= 0),
    expected_pipeline_minor   BIGINT      CHECK (expected_pipeline_minor IS NULL OR expected_pipeline_minor >= 0),
    status                    TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'approved', 'rejected', 'cancelled', 'closed')),
    approved_amount_minor     BIGINT      CHECK (approved_amount_minor IS NULL OR approved_amount_minor >= 0),
    -- Running total of claims paid against this request.
    claimed_amount_minor      BIGINT      NOT NULL DEFAULT 0 CHECK (claimed_amount_minor >= 0),
    submitted_at              TIMESTAMPTZ,
    submitted_by              TEXT,
    decided_at                TIMESTAMPTZ,
    decided_by                TEXT,
    decision_notes            TEXT,
    claim_deadline            TIMESTAMPTZ,
    closed_at                 TIMESTAMPTZ,
    closed_reason             TEXT,
    cancelled_reason          TEXT,
    version                   INTEGER     NOT NULL DEFAULT 1,
    created_at                TIMESTAMPTZ NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (activity_end >= activity_start),
    CHECK (approved_amount_minor IS NULL OR approved_amount_minor <= requested_amount_minor),
    CHECK (status = 'draft' OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
    CHECK (status NOT IN ('approved', 'rejected') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
    -- Approval sets both the amount and the window the claim must land in.
    CHECK (status <> 'approved' OR (approved_amount_minor IS NOT NULL AND claim_deadline IS NOT NULL)),
    CHECK (status <> 'rejected' OR decision_notes IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL),
    CHECK (status <> 'closed' OR closed_at IS NOT NULL),
    -- Never reimburse more than was approved.
    CHECK (claimed_amount_minor <= COALESCE(approved_amount_minor, 0))
);
CREATE INDEX prmc_mdf_requests_partner_idx  ON prmc_mdf_requests (tenant_id, partner_id, status);
CREATE INDEX prmc_mdf_requests_budget_idx   ON prmc_mdf_requests (budget_id, status);
CREATE INDEX prmc_mdf_requests_deadline_idx ON prmc_mdf_requests (tenant_id, claim_deadline)
    WHERE status = 'approved';

CREATE TABLE prmc_mdf_claims (
    id                     TEXT        PRIMARY KEY,
    tenant_id              TEXT        NOT NULL,
    number                 TEXT        NOT NULL CHECK (number ~ '^CLM-[0-9]{5,}$'),
    request_id             TEXT        NOT NULL REFERENCES prmc_mdf_requests (id) ON DELETE RESTRICT,
    partner_id             TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE RESTRICT,
    budget_id              TEXT        NOT NULL REFERENCES prmc_mdf_budgets (id) ON DELETE RESTRICT,
    allocation_id          TEXT        NOT NULL REFERENCES prmc_mdf_allocations (id) ON DELETE RESTRICT,
    currency               CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    claimed_amount_minor   BIGINT      NOT NULL CHECK (claimed_amount_minor > 0),
    approved_amount_minor  BIGINT      CHECK (approved_amount_minor IS NULL OR approved_amount_minor >= 0),
    status                 TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'in_review', 'approved', 'rejected', 'paid')),
    actual_leads           INTEGER     CHECK (actual_leads IS NULL OR actual_leads >= 0),
    actual_pipeline_minor  BIGINT      CHECK (actual_pipeline_minor IS NULL OR actual_pipeline_minor >= 0),
    activity_summary       TEXT,
    submitted_at           TIMESTAMPTZ,
    submitted_by           TEXT,
    review_started_at      TIMESTAMPTZ,
    reviewed_by            TEXT,
    decided_at             TIMESTAMPTZ,
    decision_notes         TEXT,
    short_pay_reason       TEXT,
    rejection_reason       TEXT,
    payment_reference      TEXT,
    paid_at                TIMESTAMPTZ,
    version                INTEGER     NOT NULL DEFAULT 1,
    created_at             TIMESTAMPTZ NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (approved_amount_minor IS NULL OR approved_amount_minor <= claimed_amount_minor),
    CHECK (status = 'draft' OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
    CHECK (status NOT IN ('in_review', 'approved', 'rejected', 'paid') OR review_started_at IS NOT NULL),
    CHECK (status NOT IN ('approved', 'paid') OR approved_amount_minor IS NOT NULL),
    -- Paying less than claimed is allowed, but it has to be explained.
    CHECK (status NOT IN ('approved', 'paid')
           OR approved_amount_minor = claimed_amount_minor
           OR short_pay_reason IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND payment_reference IS NOT NULL))
);
CREATE INDEX prmc_mdf_claims_request_idx ON prmc_mdf_claims (request_id);
CREATE INDEX prmc_mdf_claims_partner_idx ON prmc_mdf_claims (tenant_id, partner_id, status);

CREATE TABLE prmc_mdf_claim_proofs (
    id           TEXT        PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    claim_id     TEXT        NOT NULL REFERENCES prmc_mdf_claims (id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL CHECK (kind IN (
        'invoice', 'receipt', 'activity_report', 'attendee_list', 'screenshot', 'lead_export')),
    reference    TEXT        NOT NULL CHECK (length(reference) >= 1),
    document_url TEXT,
    amount_minor BIGINT      CHECK (amount_minor IS NULL OR amount_minor >= 0),
    issued_at    TIMESTAMPTZ,
    uploaded_at  TIMESTAMPTZ NOT NULL,
    uploaded_by  TEXT        NOT NULL,
    -- The same document cannot be attached twice.
    UNIQUE (claim_id, kind, reference),
    -- Financial proof has to carry the amount it evidences.
    CHECK (kind NOT IN ('invoice', 'receipt') OR amount_minor IS NOT NULL)
);
CREATE INDEX prmc_mdf_claim_proofs_claim_idx ON prmc_mdf_claim_proofs (claim_id);
