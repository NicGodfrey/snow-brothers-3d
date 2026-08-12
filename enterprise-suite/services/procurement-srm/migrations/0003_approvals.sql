-- Procurement SRM: approval matrices and running approval chains.
--
-- A policy is a per-tenant, per-document-type set of amount-banded rules. Each
-- rule carries an ordered chain of steps; a rule with no steps auto-approves,
-- which is how routine spend clears without a human.

CREATE TABLE proc_approval_policies (
    id            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    code          TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
    name          TEXT        NOT NULL CHECK (length(name) >= 3),
    document_type TEXT        NOT NULL CHECK (document_type IN (
        'requisition', 'purchase_order', 'invoice', 'blanket_agreement')),
    currency      CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    version       INTEGER     NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code)
);
CREATE INDEX proc_approval_policies_type_idx
    ON proc_approval_policies (tenant_id, document_type, active);

-- Amount bands are half-open: [min, max). A NULL max is the open-ended top
-- band, and rule selection prefers the most specific match.
CREATE TABLE proc_approval_rules (
    id               TEXT   PRIMARY KEY,
    tenant_id        TEXT   NOT NULL,
    policy_id        TEXT   NOT NULL REFERENCES proc_approval_policies (id) ON DELETE CASCADE,
    code             TEXT   NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
    description      TEXT   NOT NULL,
    min_amount_minor BIGINT NOT NULL CHECK (min_amount_minor >= 0),
    max_amount_minor BIGINT CHECK (max_amount_minor > 0),
    UNIQUE (policy_id, code),
    CHECK (max_amount_minor IS NULL OR max_amount_minor > min_amount_minor)
);

CREATE TABLE proc_approval_rule_categories (
    tenant_id     TEXT NOT NULL,
    rule_id       TEXT NOT NULL REFERENCES proc_approval_rules (id) ON DELETE CASCADE,
    category_code TEXT NOT NULL,
    PRIMARY KEY (rule_id, category_code)
);

CREATE TABLE proc_approval_rule_cost_centers (
    tenant_id   TEXT NOT NULL,
    rule_id     TEXT NOT NULL REFERENCES proc_approval_rules (id) ON DELETE CASCADE,
    cost_center TEXT NOT NULL,
    PRIMARY KEY (rule_id, cost_center)
);

CREATE TABLE proc_approval_rule_steps (
    id                    TEXT     PRIMARY KEY,
    tenant_id             TEXT     NOT NULL,
    rule_id               TEXT     NOT NULL REFERENCES proc_approval_rules (id) ON DELETE CASCADE,
    sequence              SMALLINT NOT NULL CHECK (sequence >= 1),
    name                  TEXT     NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
    role_code             TEXT     NOT NULL CHECK (role_code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
    -- Named approvers narrow a step to specific people; empty means "any
    -- holder of the role".
    approver_ids          TEXT[]   NOT NULL DEFAULT '{}',
    quorum                SMALLINT NOT NULL DEFAULT 1 CHECK (quorum BETWEEN 1 AND 10),
    sla_hours             SMALLINT NOT NULL DEFAULT 48 CHECK (sla_hours BETWEEN 1 AND 720),
    escalation_role_code  TEXT,
    allow_self_approval   BOOLEAN  NOT NULL DEFAULT FALSE,
    UNIQUE (rule_id, sequence),
    CHECK (cardinality(approver_ids) = 0 OR quorum <= cardinality(approver_ids))
);

-- One running chain per document decision. The document aggregate never
-- learns who approves; it only receives the outcome.
CREATE TABLE proc_approval_requests (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    document_type       TEXT        NOT NULL CHECK (document_type IN (
        'requisition', 'purchase_order', 'invoice', 'blanket_agreement')),
    document_id         TEXT        NOT NULL,
    document_number     TEXT        NOT NULL,
    amount_minor        BIGINT      NOT NULL,
    currency            CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    requested_by        TEXT        NOT NULL,
    policy_code         TEXT        NOT NULL,
    rule_code           TEXT        NOT NULL,
    current_step_index  SMALLINT    NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
    status              TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    auto_approved       BOOLEAN     NOT NULL DEFAULT FALSE,
    decided_at          TIMESTAMPTZ,
    rejection_reason    TEXT,
    cancellation_reason TEXT,
    context             JSONB,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    CHECK (status = 'pending' OR decided_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL)
);
CREATE INDEX proc_approval_requests_document_idx
    ON proc_approval_requests (tenant_id, document_id);
-- A document can only have one chain running at a time.
CREATE UNIQUE INDEX proc_approval_requests_pending_idx
    ON proc_approval_requests (tenant_id, document_id) WHERE status = 'pending';
CREATE INDEX proc_approval_requests_open_idx
    ON proc_approval_requests (tenant_id, status, created_at);

CREATE TABLE proc_approval_request_steps (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    request_id           TEXT        NOT NULL REFERENCES proc_approval_requests (id) ON DELETE CASCADE,
    sequence             SMALLINT    NOT NULL CHECK (sequence >= 1),
    name                 TEXT        NOT NULL,
    role_code            TEXT        NOT NULL,
    approver_ids         TEXT[]      NOT NULL DEFAULT '{}',
    quorum               SMALLINT    NOT NULL DEFAULT 1 CHECK (quorum BETWEEN 1 AND 10),
    sla_hours            SMALLINT    NOT NULL CHECK (sla_hours BETWEEN 1 AND 720),
    escalation_role_code TEXT,
    allow_self_approval  BOOLEAN     NOT NULL DEFAULT FALSE,
    status               TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
    due_at               TIMESTAMPTZ,
    escalated_at         TIMESTAMPTZ,
    escalation_reason    TEXT,
    UNIQUE (request_id, sequence),
    CHECK (escalated_at IS NULL OR escalation_reason IS NOT NULL)
);
CREATE INDEX proc_approval_request_steps_due_idx
    ON proc_approval_request_steps (tenant_id, status, due_at) WHERE status = 'pending';

CREATE TABLE proc_approval_decisions (
    id            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    step_id       TEXT        NOT NULL REFERENCES proc_approval_request_steps (id) ON DELETE CASCADE,
    approver_id   TEXT        NOT NULL,
    decision      TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    decided_at    TIMESTAMPTZ NOT NULL,
    comment       TEXT,
    -- Set when the decision was taken under a delegation.
    on_behalf_of  TEXT,
    UNIQUE (step_id, approver_id)
);

CREATE TABLE proc_approval_delegations (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    step_id           TEXT        NOT NULL REFERENCES proc_approval_request_steps (id) ON DELETE CASCADE,
    from_approver_id  TEXT        NOT NULL,
    to_approver_id    TEXT        NOT NULL,
    reason            TEXT        NOT NULL,
    delegated_at      TIMESTAMPTZ NOT NULL,
    CHECK (from_approver_id <> to_approver_id)
);
