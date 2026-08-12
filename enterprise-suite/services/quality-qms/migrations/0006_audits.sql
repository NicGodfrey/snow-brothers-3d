-- quality-qms 0006: audit checklist templates, audits, responses, findings

CREATE TABLE quality.audit_template (
    id         TEXT        PRIMARY KEY,
    tenant_id  TEXT        NOT NULL,
    code       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    standard   TEXT,
    status     TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version    INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT audit_template_code_uq UNIQUE (tenant_id, code)
);

CREATE TABLE quality.audit_template_section (
    id          TEXT    PRIMARY KEY,
    tenant_id   TEXT    NOT NULL,
    template_id TEXT    NOT NULL REFERENCES quality.audit_template (id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quality.audit_template_item (
    id              TEXT    PRIMARY KEY,
    tenant_id       TEXT    NOT NULL,
    section_id      TEXT    NOT NULL REFERENCES quality.audit_template_section (id) ON DELETE CASCADE,
    question        TEXT    NOT NULL,
    answer_type     TEXT    NOT NULL CHECK (answer_type IN ('conformity', 'score', 'yes-no')),
    guidance        TEXT,
    requirement_ref TEXT,
    weight          NUMERIC NOT NULL DEFAULT 1 CHECK (weight > 0),
    position        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quality.audit (
    id            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    audit_number  TEXT        NOT NULL,
    audit_type    TEXT        NOT NULL CHECK (
        audit_type IN ('internal', 'supplier', 'process', 'certification')
    ),
    template_id   TEXT        NOT NULL REFERENCES quality.audit_template (id),
    template_code TEXT        NOT NULL,
    scope         TEXT        NOT NULL,
    -- auditee: site/department for internal, supplier for supplier audits
    auditee_site        TEXT,
    auditee_department  TEXT,
    auditee_supplier_id TEXT,
    lead_auditor  TEXT        NOT NULL,
    auditors      TEXT[]      NOT NULL DEFAULT '{}',
    planned_from  TIMESTAMPTZ NOT NULL,
    planned_to    TIMESTAMPTZ NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'in-progress', 'review', 'completed', 'closed', 'cancelled')
    ),
    -- checklist snapshot (sections + items as JSON, frozen at planning)
    checklist_snapshot JSONB  NOT NULL,
    -- result
    score_percent   NUMERIC CHECK (score_percent IS NULL OR (score_percent >= 0 AND score_percent <= 100)),
    achieved_points NUMERIC,
    max_points      NUMERIC,
    outcome         TEXT CHECK (outcome IS NULL OR outcome IN ('pass', 'conditional', 'fail')),
    result_summary  TEXT,
    cancellation_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    version       INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT audit_number_uq UNIQUE (tenant_id, audit_number),
    CONSTRAINT planned_window_ordered CHECK (planned_to >= planned_from),
    CONSTRAINT supplier_audit_needs_supplier CHECK (
        audit_type <> 'supplier' OR auditee_supplier_id IS NOT NULL
    ),
    CONSTRAINT completed_has_result CHECK (
        status NOT IN ('completed', 'closed') OR outcome IS NOT NULL
    )
);

CREATE INDEX audit_status_ix   ON quality.audit (tenant_id, status);
CREATE INDEX audit_supplier_ix ON quality.audit (tenant_id, auditee_supplier_id)
    WHERE auditee_supplier_id IS NOT NULL;

CREATE TABLE quality.audit_response (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    audit_id    TEXT        NOT NULL REFERENCES quality.audit (id) ON DELETE CASCADE,
    item_id     TEXT        NOT NULL,   -- references an item inside checklist_snapshot
    answer_kind TEXT        NOT NULL CHECK (answer_kind IN ('conformity', 'score', 'yes-no')),
    answer_value TEXT       NOT NULL,   -- 'conform' | 'minor-nc' | ... | '0'..'5' | 'yes' | 'no'
    evidence    TEXT,
    comment     TEXT,
    answered_by TEXT        NOT NULL,
    answered_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT one_response_per_item UNIQUE (audit_id, item_id)
);

CREATE TABLE quality.audit_finding (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    audit_id        TEXT        NOT NULL REFERENCES quality.audit (id) ON DELETE CASCADE,
    classification  TEXT        NOT NULL CHECK (
        classification IN ('observation', 'ofi', 'minor-nc', 'major-nc')
    ),
    description     TEXT        NOT NULL,
    item_id         TEXT,
    requirement_ref TEXT,
    ncr_id          TEXT REFERENCES quality.ncr (id),
    capa_id         TEXT REFERENCES quality.capa (id),
    recorded_by     TEXT        NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX audit_finding_audit_ix ON quality.audit_finding (audit_id);

-- Backfill FKs deferred from earlier migrations.
ALTER TABLE quality.ncr
    ADD CONSTRAINT ncr_audit_fk FOREIGN KEY (audit_id) REFERENCES quality.audit (id);
ALTER TABLE quality.supplier_quality_event
    ADD CONSTRAINT supplier_event_audit_fk FOREIGN KEY (audit_id) REFERENCES quality.audit (id);
ALTER TABLE quality.capa
    ADD CONSTRAINT capa_source_audit_fk FOREIGN KEY (source_audit_id) REFERENCES quality.audit (id);
ALTER TABLE quality.capa
    ADD CONSTRAINT capa_source_supplier_event_fk
    FOREIGN KEY (source_supplier_event_id) REFERENCES quality.supplier_quality_event (id);
