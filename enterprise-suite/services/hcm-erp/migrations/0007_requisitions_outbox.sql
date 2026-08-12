-- 0007: Hiring requisitions (with approvals and hires) and the event outbox.

CREATE TABLE hiring_requisitions (
    id                 TEXT        NOT NULL,
    tenant_id          TEXT        NOT NULL,
    position_id        TEXT        NOT NULL,
    org_unit_id        TEXT        NOT NULL,
    title              TEXT        NOT NULL,
    headcount          INTEGER     NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 100),
    hiring_manager_id  TEXT        NOT NULL,
    recruiter_id       TEXT,
    justification      TEXT        NOT NULL,
    salary_band_min    BIGINT,
    salary_band_max    BIGINT,
    band_currency      CHAR(3),
    target_start_date  DATE,
    status             TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'open', 'on_hold', 'filled', 'cancelled'
    )),
    opened_at          TIMESTAMPTZ,
    filled_at          TIMESTAMPTZ,
    hold_note          TEXT,
    cancellation_note  TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    version            INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT reqs_position_fk FOREIGN KEY (tenant_id, position_id)
        REFERENCES positions (tenant_id, id),
    CONSTRAINT reqs_org_unit_fk FOREIGN KEY (tenant_id, org_unit_id)
        REFERENCES org_units (tenant_id, id),
    CONSTRAINT reqs_manager_fk FOREIGN KEY (tenant_id, hiring_manager_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT reqs_band_rule CHECK (
        (salary_band_min IS NULL AND salary_band_max IS NULL AND band_currency IS NULL)
        OR (salary_band_min > 0 AND salary_band_max >= salary_band_min AND band_currency IS NOT NULL)
    )
);

CREATE INDEX reqs_status_idx ON hiring_requisitions (tenant_id, status);
CREATE INDEX reqs_position_idx ON hiring_requisitions (tenant_id, position_id);

CREATE TABLE requisition_approvals (
    id              TEXT        NOT NULL,
    tenant_id       TEXT        NOT NULL,
    requisition_id  TEXT        NOT NULL,
    approver_id     TEXT        NOT NULL,
    decision        TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    comment         TEXT,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT approvals_req_fk FOREIGN KEY (tenant_id, requisition_id)
        REFERENCES hiring_requisitions (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX approvals_req_idx ON requisition_approvals (tenant_id, requisition_id);

CREATE TABLE requisition_hires (
    tenant_id       TEXT        NOT NULL,
    requisition_id  TEXT        NOT NULL,
    employee_id     TEXT        NOT NULL,
    hired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, requisition_id, employee_id),
    CONSTRAINT hires_req_fk FOREIGN KEY (tenant_id, requisition_id)
        REFERENCES hiring_requisitions (tenant_id, id),
    CONSTRAINT hires_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id)
);

-- Transactional outbox: domain events are inserted in the same transaction
-- as the aggregate write and dispatched asynchronously by integration-hub.
CREATE TABLE hcm_outbox (
    event_id        TEXT        NOT NULL PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    aggregate_type  TEXT        NOT NULL,
    aggregate_id    TEXT        NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    schema_version  INTEGER     NOT NULL DEFAULT 1,
    payload         JSONB       NOT NULL,
    correlation_id  TEXT,
    causation_id    TEXT,
    dispatched_at   TIMESTAMPTZ
);

CREATE INDEX outbox_undispatched_idx ON hcm_outbox (occurred_at) WHERE dispatched_at IS NULL;
CREATE INDEX outbox_tenant_idx ON hcm_outbox (tenant_id, occurred_at);
