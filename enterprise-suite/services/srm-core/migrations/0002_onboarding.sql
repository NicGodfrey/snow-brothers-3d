-- SRM core: supplier onboarding cases — checklist, evidence, questionnaire
-- and the risk-tiered approval matrix.

CREATE TABLE srm_onboarding_cases (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    number              TEXT        NOT NULL CHECK (number ~ '^ONB-[0-9]{5,}$'),
    supplier_id         TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE RESTRICT,
    supplier_code       TEXT        NOT NULL,
    template_code       TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'in_progress' CHECK (status IN (
        'draft', 'in_progress', 'pending_approval', 'approved', 'rejected', 'withdrawn')),
    target_go_live_on   DATE,
    submitted_at        TIMESTAMPTZ,
    submitted_by        TEXT,
    decided_at          TIMESTAMPTZ,
    rejected_reason     TEXT,
    withdrawn_reason    TEXT,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (status NOT IN ('pending_approval', 'approved', 'rejected') OR submitted_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
    CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL)
);
CREATE INDEX srm_onboarding_status_idx ON srm_onboarding_cases (tenant_id, status);
CREATE INDEX srm_onboarding_supplier_idx ON srm_onboarding_cases (tenant_id, supplier_id);

-- A supplier may only have one case in flight at a time.
CREATE UNIQUE INDEX srm_onboarding_open_case_idx
    ON srm_onboarding_cases (supplier_id)
    WHERE status IN ('draft', 'in_progress', 'pending_approval');

CREATE TABLE srm_onboarding_sequences (
    tenant_id  TEXT   PRIMARY KEY,
    next_value BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE srm_onboarding_steps (
    case_id       TEXT        NOT NULL REFERENCES srm_onboarding_cases (id) ON DELETE CASCADE,
    tenant_id     TEXT        NOT NULL,
    code          TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    type          TEXT        NOT NULL CHECK (type IN (
        'form', 'document', 'questionnaire', 'verification', 'site_visit', 'training', 'approval')),
    owner_role    TEXT        NOT NULL CHECK (owner_role IN (
        'procurement', 'compliance', 'finance', 'quality', 'executive')),
    status        TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'waived')),
    required      BOOLEAN     NOT NULL DEFAULT TRUE,
    sequence      INTEGER     NOT NULL,
    -- Step codes that must be completed or waived first.
    prerequisites TEXT[]      NOT NULL DEFAULT '{}',
    -- Document codes this step gates, for `document` steps.
    document_codes TEXT[]     NOT NULL DEFAULT '{}',
    due_on        DATE,
    completed_at  TIMESTAMPTZ,
    completed_by  TEXT,
    evidence_ref  TEXT,
    waived_reason TEXT,
    PRIMARY KEY (case_id, code),
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),
    CHECK (status <> 'waived' OR waived_reason IS NOT NULL)
);
CREATE INDEX srm_onboarding_steps_order_idx ON srm_onboarding_steps (case_id, sequence);

CREATE TABLE srm_onboarding_documents (
    case_id             TEXT        NOT NULL REFERENCES srm_onboarding_cases (id) ON DELETE CASCADE,
    tenant_id           TEXT        NOT NULL,
    code                TEXT        NOT NULL,
    name                TEXT        NOT NULL,
    required            BOOLEAN     NOT NULL DEFAULT TRUE,
    status              TEXT        NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'received', 'verified', 'rejected')),
    -- When set, a verified document is materialized as a tracked certification
    -- at go-live so expiry monitoring starts immediately.
    certification_type  TEXT,
    file_ref            TEXT,
    expires_on          DATE,
    received_at         TIMESTAMPTZ,
    verified_at         TIMESTAMPTZ,
    verified_by         TEXT,
    rejected_reason     TEXT,
    PRIMARY KEY (case_id, code),
    CHECK (status = 'requested' OR file_ref IS NOT NULL),
    CHECK (status <> 'verified' OR verified_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL)
);

-- Questionnaire answers carry a 0..1 risk factor; the weighted result drives
-- the risk tier, which in turn selects the approval matrix.
CREATE TABLE srm_onboarding_answers (
    case_id      TEXT        NOT NULL REFERENCES srm_onboarding_cases (id) ON DELETE CASCADE,
    tenant_id    TEXT        NOT NULL,
    code         TEXT        NOT NULL,
    value        TEXT        NOT NULL,
    risk_factor  NUMERIC(4,3) NOT NULL CHECK (risk_factor BETWEEN 0 AND 1),
    note         TEXT,
    answered_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (case_id, code)
);

CREATE TABLE srm_onboarding_approvals (
    case_id     TEXT        NOT NULL REFERENCES srm_onboarding_cases (id) ON DELETE CASCADE,
    tenant_id   TEXT        NOT NULL,
    role        TEXT        NOT NULL CHECK (role IN (
        'procurement', 'compliance', 'finance', 'quality', 'executive')),
    approver_id TEXT        NOT NULL,
    decision    TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    comment     TEXT,
    decided_at  TIMESTAMPTZ NOT NULL,
    -- One decision per role; the matrix is by role, not by person.
    PRIMARY KEY (case_id, role),
    CHECK (decision <> 'rejected' OR comment IS NOT NULL)
);

ALTER TABLE srm_suppliers
    ADD CONSTRAINT srm_suppliers_onboarding_fk
    FOREIGN KEY (onboarding_case_id) REFERENCES srm_onboarding_cases (id) ON DELETE SET NULL;
