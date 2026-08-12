-- 0006: Skill catalog, per-employee assessments, certifications, and grants.

CREATE TABLE skills (
    id          TEXT        NOT NULL,
    tenant_id   TEXT        NOT NULL,
    code        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    category    TEXT        NOT NULL DEFAULT 'general',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT skills_code_unique UNIQUE (tenant_id, code)
);

CREATE TABLE employee_skills (
    id             TEXT        NOT NULL,
    tenant_id      TEXT        NOT NULL,
    employee_id    TEXT        NOT NULL,
    skill_id       TEXT        NOT NULL,
    current_level  INTEGER     NOT NULL CHECK (current_level BETWEEN 1 AND 5),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT emp_skills_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT emp_skills_skill_fk FOREIGN KEY (tenant_id, skill_id)
        REFERENCES skills (tenant_id, id),
    CONSTRAINT emp_skills_unique UNIQUE (tenant_id, employee_id, skill_id)
);

CREATE INDEX emp_skills_skill_idx ON employee_skills (tenant_id, skill_id, current_level);

CREATE TABLE skill_assessments (
    id                 TEXT        NOT NULL,
    tenant_id          TEXT        NOT NULL,
    employee_skill_id  TEXT        NOT NULL,
    level              INTEGER     NOT NULL CHECK (level BETWEEN 1 AND 5),
    assessed_by        TEXT        NOT NULL,
    assessed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes              TEXT,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT assessments_emp_skill_fk FOREIGN KEY (tenant_id, employee_skill_id)
        REFERENCES employee_skills (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX assessments_emp_skill_idx ON skill_assessments (tenant_id, employee_skill_id, assessed_at);

CREATE TABLE certifications (
    id               TEXT        NOT NULL,
    tenant_id        TEXT        NOT NULL,
    code             TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    issuing_body     TEXT        NOT NULL,
    validity_months  INTEGER CHECK (validity_months > 0 AND validity_months <= 240),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version          INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT certifications_code_unique UNIQUE (tenant_id, code)
);

CREATE TABLE employee_certifications (
    id                TEXT        NOT NULL,
    tenant_id         TEXT        NOT NULL,
    employee_id       TEXT        NOT NULL,
    certification_id  TEXT        NOT NULL,
    issued_at         DATE        NOT NULL,
    expires_at        DATE,
    credential_ref    TEXT,
    status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    revocation_note   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT emp_certs_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT emp_certs_certification_fk FOREIGN KEY (tenant_id, certification_id)
        REFERENCES certifications (tenant_id, id),
    CONSTRAINT emp_certs_expiry CHECK (expires_at IS NULL OR expires_at > issued_at)
);

-- One active grant per employee per certification.
CREATE UNIQUE INDEX emp_certs_one_active
    ON employee_certifications (tenant_id, employee_id, certification_id)
    WHERE status = 'active';
CREATE INDEX emp_certs_expiring_idx ON employee_certifications (tenant_id, expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;
