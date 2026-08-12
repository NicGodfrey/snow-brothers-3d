-- SRM core: certifications on file and the audits that qualify a supplier.

CREATE TABLE srm_certifications (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    supplier_id         TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    supplier_code       TEXT        NOT NULL,
    type                TEXT        NOT NULL,
    issuer              TEXT        NOT NULL,
    certificate_number  TEXT        NOT NULL,
    scope               TEXT,
    issued_on           DATE        NOT NULL,
    expires_on          DATE        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'pending_verification' CHECK (status IN (
        'pending_verification', 'valid', 'expired', 'revoked', 'rejected')),
    -- Empty means the certificate covers the whole supplier.
    site_ids            TEXT[]      NOT NULL DEFAULT '{}',
    document_ref        TEXT,
    verified_at         TIMESTAMPTZ,
    verified_by         TEXT,
    rejected_reason     TEXT,
    revoked_reason      TEXT,
    revoked_at          TIMESTAMPTZ,
    -- Set once the sweep has warned, so the warning fires exactly once.
    expiry_warned_at    TIMESTAMPTZ,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    CHECK (expires_on > issued_on),
    CHECK (status <> 'valid' OR verified_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
    CHECK (status <> 'revoked' OR revoked_reason IS NOT NULL)
);
-- The same certificate number may be re-recorded only after a revocation.
CREATE UNIQUE INDEX srm_certifications_number_idx
    ON srm_certifications (supplier_id, type, certificate_number)
    WHERE status <> 'revoked';
-- Drives the nightly expiry sweep.
CREATE INDEX srm_certifications_expiry_idx
    ON srm_certifications (tenant_id, expires_on)
    WHERE status = 'valid';
CREATE INDEX srm_certifications_supplier_idx ON srm_certifications (tenant_id, supplier_id, type);

CREATE TABLE srm_certification_renewals (
    certification_id    TEXT        NOT NULL REFERENCES srm_certifications (id) ON DELETE CASCADE,
    tenant_id           TEXT        NOT NULL,
    sequence            SMALLINT    NOT NULL,
    certificate_number  TEXT        NOT NULL,
    issued_on           DATE        NOT NULL,
    expires_on          DATE        NOT NULL,
    renewed_by          TEXT        NOT NULL,
    renewed_at          TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (certification_id, sequence),
    CHECK (expires_on > issued_on)
);

CREATE TABLE srm_qualifications (
    id               TEXT        PRIMARY KEY,
    tenant_id        TEXT        NOT NULL,
    reference        TEXT        NOT NULL CHECK (reference ~ '^QAL-[0-9]{5,}$'),
    supplier_id      TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    supplier_code    TEXT        NOT NULL,
    -- A qualification may be scoped to one category and/or one site.
    category_id      TEXT        REFERENCES srm_categories (id) ON DELETE SET NULL,
    site_id          TEXT        REFERENCES srm_supplier_sites (id) ON DELETE SET NULL,
    type             TEXT        NOT NULL CHECK (type IN (
        'initial', 'requalification', 'for_cause', 'surveillance')),
    method           TEXT        NOT NULL CHECK (method IN (
        'desk_review', 'self_assessment', 'virtual_audit', 'onsite_audit')),
    status           TEXT        NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'completed', 'expired', 'withdrawn')),
    outcome          TEXT        NOT NULL DEFAULT 'pending'
        CHECK (outcome IN ('pending', 'passed', 'conditional', 'failed')),
    scheduled_on     DATE        NOT NULL,
    started_at       TIMESTAMPTZ,
    started_by       TEXT,
    completed_on     DATE,
    completed_by     TEXT,
    score            NUMERIC(5,2) CHECK (score BETWEEN 0 AND 100),
    validity_months  SMALLINT    CHECK (validity_months BETWEEN 3 AND 60),
    valid_until      DATE,
    -- Conditions attached to a conditional pass.
    conditions       TEXT[]      NOT NULL DEFAULT '{}',
    summary          TEXT,
    withdrawn_reason TEXT,
    version          INTEGER     NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, reference),
    CHECK (status <> 'completed' OR (completed_on IS NOT NULL AND score IS NOT NULL)),
    CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL),
    CHECK (outcome = 'pending' OR status IN ('completed', 'expired'))
);
CREATE INDEX srm_qualifications_supplier_idx ON srm_qualifications (tenant_id, supplier_id, status);
-- Drives the requalification-due queue.
CREATE INDEX srm_qualifications_validity_idx
    ON srm_qualifications (tenant_id, valid_until)
    WHERE status = 'completed';

CREATE TABLE srm_qualification_sequences (
    tenant_id  TEXT   PRIMARY KEY,
    next_value BIGINT NOT NULL DEFAULT 1
);

-- Section scores are weighted; the weights are snapshotted per audit so a
-- later change to the standard template cannot rewrite a finished audit.
CREATE TABLE srm_qualification_sections (
    qualification_id TEXT         NOT NULL REFERENCES srm_qualifications (id) ON DELETE CASCADE,
    tenant_id        TEXT         NOT NULL,
    code             TEXT         NOT NULL CHECK (code IN (
        'quality_system', 'manufacturing_capability', 'delivery_performance', 'financial_health',
        'esg_compliance', 'information_security', 'capacity_scalability')),
    -- Percentage weights; the aggregate normalises them when scoring.
    weight           NUMERIC(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
    score            NUMERIC(5,2) CHECK (score BETWEEN 0 AND 100),
    notes            TEXT,
    scored_at        TIMESTAMPTZ,
    PRIMARY KEY (qualification_id, code),
    CHECK (score IS NULL OR scored_at IS NOT NULL)
);

CREATE TABLE srm_qualification_findings (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    qualification_id  TEXT        NOT NULL REFERENCES srm_qualifications (id) ON DELETE CASCADE,
    section           TEXT        NOT NULL,
    severity          TEXT        NOT NULL CHECK (severity IN (
        'observation', 'minor', 'major', 'critical')),
    description       TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed', 'waived')),
    -- Corrective and preventive action, when one was demanded.
    capa_action       TEXT,
    capa_owner_id     TEXT,
    capa_due_on       DATE,
    closed_at         TIMESTAMPTZ,
    closed_by         TEXT,
    closure_evidence  TEXT,
    waived_reason     TEXT,
    raised_at         TIMESTAMPTZ NOT NULL,
    CHECK (status <> 'closed' OR closure_evidence IS NOT NULL),
    CHECK (status <> 'waived' OR waived_reason IS NOT NULL),
    -- A critical finding always needs a CAPA on record.
    CHECK (severity <> 'critical' OR capa_action IS NOT NULL)
);
CREATE INDEX srm_qualification_findings_open_idx
    ON srm_qualification_findings (qualification_id, severity)
    WHERE status = 'open';
