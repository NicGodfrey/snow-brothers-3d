-- PRM core: enablement — courses, exams and certifications.
--
-- Courses and certification definitions are the catalog; enrollments record an
-- individual working through a course, and a certification is the credential
-- awarded once every required course has been passed. Certifications are held
-- by a *person* and counted at the *partner*, which is why both ids are on the
-- row: partner tiering counts certified individuals, entitlements check the
-- individual.

CREATE TABLE prmc_courses (
    id                        TEXT        PRIMARY KEY,
    tenant_id                 TEXT        NOT NULL,
    code                      TEXT        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
    title                     TEXT        NOT NULL CHECK (length(title) >= 1),
    description               TEXT,
    track                     TEXT        NOT NULL CHECK (track IN (
        'sales', 'presales', 'technical', 'support', 'marketing', 'compliance')),
    delivery_mode             TEXT        NOT NULL CHECK (delivery_mode IN (
        'self_paced', 'virtual_classroom', 'in_person', 'lab')),
    duration_minutes          INTEGER     NOT NULL CHECK (duration_minutes BETWEEN 5 AND 10000),
    passing_score             INTEGER     NOT NULL DEFAULT 70 CHECK (passing_score BETWEEN 1 AND 100),
    max_attempts              INTEGER     NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    prerequisite_course_codes TEXT[]      NOT NULL DEFAULT '{}',
    -- Bumped when the syllabus changes; enrollments pin the version they took.
    version                   INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    active                    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    CHECK (NOT (code = ANY (prerequisite_course_codes)))
);

CREATE TABLE prmc_certification_definitions (
    id                    TEXT        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    code                  TEXT        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
    name                  TEXT        NOT NULL CHECK (length(name) >= 1),
    track                 TEXT        NOT NULL CHECK (track IN (
        'sales', 'presales', 'technical', 'support', 'marketing', 'compliance')),
    level                 TEXT        NOT NULL CHECK (level IN ('associate', 'professional', 'expert')),
    required_course_codes TEXT[]      NOT NULL CHECK (cardinality(required_course_codes) >= 1),
    -- Courses to retake at renewal; defaults to the required set.
    renewal_course_codes  TEXT[]      NOT NULL DEFAULT '{}',
    validity_months       INTEGER     NOT NULL DEFAULT 24 CHECK (validity_months BETWEEN 1 AND 120),
    -- How early a holder may renew before expiry.
    renewal_window_days   INTEGER     NOT NULL DEFAULT 90 CHECK (renewal_window_days BETWEEN 0 AND 365),
    active                BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code)
);

CREATE TABLE prmc_enrollments (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    partner_id      TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    portal_user_id  TEXT        NOT NULL,
    course_code     TEXT        NOT NULL,
    course_version  INTEGER     NOT NULL CHECK (course_version >= 1),
    -- Copied from the course at enrollment time so changing the catalog cannot
    -- retroactively fail somebody who already passed.
    passing_score   INTEGER     NOT NULL CHECK (passing_score BETWEEN 1 AND 100),
    max_attempts    INTEGER     NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
    status          TEXT        NOT NULL DEFAULT 'enrolled' CHECK (status IN (
        'enrolled', 'in_progress', 'completed', 'failed', 'withdrawn')),
    enrolled_at     TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    best_score      INTEGER     CHECK (best_score IS NULL OR best_score BETWEEN 0 AND 100),
    withdrawn_reason TEXT,
    attempt_resets  INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_resets >= 0),
    version         INTEGER     NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    CHECK (status = 'enrolled' OR started_at IS NOT NULL),
    CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND best_score >= passing_score)),
    CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL)
);
-- One open enrollment per person per course. Completed and withdrawn rows do
-- not block a retake, which is how recertification works.
CREATE UNIQUE INDEX prmc_enrollments_open_idx
    ON prmc_enrollments (tenant_id, portal_user_id, course_code)
    WHERE status IN ('enrolled', 'in_progress', 'failed');
CREATE INDEX prmc_enrollments_partner_idx ON prmc_enrollments (tenant_id, partner_id, status);

CREATE TABLE prmc_enrollment_attempts (
    enrollment_id TEXT        NOT NULL REFERENCES prmc_enrollments (id) ON DELETE CASCADE,
    tenant_id     TEXT        NOT NULL,
    attempt       INTEGER     NOT NULL CHECK (attempt >= 1),
    score         INTEGER     NOT NULL CHECK (score BETWEEN 0 AND 100),
    passed        BOOLEAN     NOT NULL,
    proctored     BOOLEAN     NOT NULL DEFAULT FALSE,
    taken_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (enrollment_id, attempt)
);

CREATE TABLE prmc_certifications (
    id                      TEXT        PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    certification_code      TEXT        NOT NULL,
    level                   TEXT        NOT NULL CHECK (level IN ('associate', 'professional', 'expert')),
    partner_id              TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    portal_user_id          TEXT        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked')),
    awarded_at              TIMESTAMPTZ NOT NULL,
    expires_at              TIMESTAMPTZ NOT NULL,
    awarded_by              TEXT        NOT NULL,
    -- The enrollments that evidenced the award; kept for audit.
    evidence_enrollment_ids TEXT[]      NOT NULL DEFAULT '{}',
    expired_at              TIMESTAMPTZ,
    revoked_at              TIMESTAMPTZ,
    revoked_by              TEXT,
    revocation_reason       TEXT,
    version                 INTEGER     NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > awarded_at),
    CHECK (status <> 'expired' OR expired_at IS NOT NULL),
    CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL
                                   AND revocation_reason IS NOT NULL))
);
-- A person holds a given certification once; renewal extends that row.
CREATE UNIQUE INDEX prmc_certifications_holder_idx
    ON prmc_certifications (tenant_id, portal_user_id, certification_code);
CREATE INDEX prmc_certifications_partner_idx ON prmc_certifications (tenant_id, partner_id, status);
CREATE INDEX prmc_certifications_expiry_idx  ON prmc_certifications (tenant_id, expires_at)
    WHERE status = 'active';

CREATE TABLE prmc_certification_renewals (
    id                      BIGSERIAL   PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    certification_id        TEXT        NOT NULL REFERENCES prmc_certifications (id) ON DELETE CASCADE,
    renewed_at              TIMESTAMPTZ NOT NULL,
    previous_expires_at     TIMESTAMPTZ NOT NULL,
    expires_at              TIMESTAMPTZ NOT NULL,
    renewed_by              TEXT        NOT NULL,
    evidence_enrollment_ids TEXT[]      NOT NULL DEFAULT '{}',
    -- A renewal always pushes the expiry out.
    CHECK (expires_at > previous_expires_at)
);
CREATE INDEX prmc_certification_renewals_cert_idx
    ON prmc_certification_renewals (certification_id, renewed_at DESC);
