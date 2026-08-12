-- quality-qms 0004: CAPA cases, actions, root cause, effectiveness

CREATE TABLE quality.capa (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    capa_number     TEXT        NOT NULL,
    capa_type       TEXT        NOT NULL CHECK (capa_type IN ('corrective', 'preventive')),
    title           TEXT        NOT NULL,
    description     TEXT        NOT NULL,
    priority        TEXT        NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status          TEXT        NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'open', 'investigation', 'action-planning',
                   'implementation', 'verification', 'closed', 'cancelled')
    ),
    owner_user_id   TEXT        NOT NULL,
    -- risk rating (FMEA-style); rpn = severity * occurrence * detection
    risk_severity   INTEGER CHECK (risk_severity   BETWEEN 1 AND 5),
    risk_occurrence INTEGER CHECK (risk_occurrence BETWEEN 1 AND 5),
    risk_detection  INTEGER CHECK (risk_detection  BETWEEN 1 AND 5),
    risk_rpn        INTEGER CHECK (risk_rpn BETWEEN 1 AND 125),
    -- source linkage
    source_audit_id          TEXT,
    source_supplier_event_id TEXT,
    source_supplier_id       TEXT,
    source_customer_ref      TEXT,
    -- root cause analysis
    root_cause_method       TEXT CHECK (
        root_cause_method IS NULL OR root_cause_method IN ('5-whys', 'fishbone', '8d', 'fault-tree', 'other')
    ),
    root_cause_summary      TEXT,
    root_cause_causes       JSONB,   -- [{category?, description}]
    root_cause_completed_by TEXT,
    root_cause_completed_at TIMESTAMPTZ,
    -- effectiveness check
    effectiveness_criteria    TEXT,
    effectiveness_due_at      TIMESTAMPTZ,
    effectiveness_outcome     TEXT CHECK (
        effectiveness_outcome IS NULL OR effectiveness_outcome IN ('effective', 'not-effective')
    ),
    effectiveness_verified_by TEXT,
    effectiveness_verified_at TIMESTAMPTZ,
    effectiveness_note        TEXT,
    rework_cycles   INTEGER     NOT NULL DEFAULT 0,
    closed_by       TEXT,
    closed_at       TIMESTAMPTZ,
    closure_note    TEXT,
    cancelled_by    TEXT,
    cancelled_at    TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    version         INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT capa_number_uq UNIQUE (tenant_id, capa_number),
    CONSTRAINT risk_all_or_none CHECK (
        (risk_severity IS NULL AND risk_occurrence IS NULL AND risk_detection IS NULL AND risk_rpn IS NULL)
        OR
        (risk_severity IS NOT NULL AND risk_occurrence IS NOT NULL AND risk_detection IS NOT NULL AND risk_rpn IS NOT NULL)
    ),
    CONSTRAINT closed_needs_effective_outcome CHECK (
        status <> 'closed' OR effectiveness_outcome = 'effective'
    )
);

CREATE INDEX capa_status_ix ON quality.capa (tenant_id, status);

-- Many-to-many: a CAPA can address several NCRs.
CREATE TABLE quality.capa_ncr_link (
    capa_id  TEXT NOT NULL REFERENCES quality.capa (id) ON DELETE CASCADE,
    ncr_id   TEXT NOT NULL REFERENCES quality.ncr (id),
    PRIMARY KEY (capa_id, ncr_id)
);

-- Backfill FK from 0003 now that quality.capa exists.
ALTER TABLE quality.ncr
    ADD CONSTRAINT ncr_capa_fk FOREIGN KEY (capa_id) REFERENCES quality.capa (id);

CREATE TABLE quality.capa_action (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    capa_id         TEXT        NOT NULL REFERENCES quality.capa (id) ON DELETE CASCADE,
    action_type     TEXT        NOT NULL CHECK (action_type IN ('containment', 'corrective', 'preventive')),
    description     TEXT        NOT NULL,
    owner_user_id   TEXT        NOT NULL,
    due_at          TIMESTAMPTZ NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'in-progress', 'completed', 'cancelled')
    ),
    completed_at    TIMESTAMPTZ,
    completion_note TEXT,
    CONSTRAINT completed_actions_have_completed_at CHECK (
        status <> 'completed' OR completed_at IS NOT NULL
    )
);

CREATE INDEX capa_action_capa_ix ON quality.capa_action (capa_id);
CREATE INDEX capa_action_overdue_ix ON quality.capa_action (tenant_id, due_at)
    WHERE status IN ('open', 'in-progress');
