-- PRM core: portal identities and entitlements.
--
-- A portal user is a named person at a partner. What they may do is decided by
-- resolution, not by a stored ACL: each entitlement definition carries a policy
-- (tier, roles, certifications, contract types) and the grant table only holds
-- deliberate overrides. Grants are revoked, never deleted, so "why did this
-- partner have access in March?" stays answerable.

CREATE TABLE prmc_portal_users (
    id                 TEXT        PRIMARY KEY,
    tenant_id          TEXT        NOT NULL,
    partner_id         TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE CASCADE,
    email              TEXT        NOT NULL
        CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    first_name         TEXT        NOT NULL CHECK (length(first_name) >= 1),
    last_name          TEXT        NOT NULL CHECK (length(last_name) >= 1),
    job_title          TEXT,
    phone              TEXT,
    status             TEXT        NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'active', 'disabled')),
    roles              TEXT[]      NOT NULL CHECK (
        cardinality(roles) >= 1
        AND roles <@ ARRAY['portal_admin', 'sales_rep', 'marketing_manager',
                           'technical_lead', 'finance', 'support_agent']::TEXT[]),
    locale             TEXT        NOT NULL DEFAULT 'en-US',
    invited_at         TIMESTAMPTZ NOT NULL,
    invited_by         TEXT        NOT NULL,
    invite_expires_at  TIMESTAMPTZ NOT NULL,
    -- Handle for the invite mail; the token itself is never stored.
    invite_token_ref   TEXT        NOT NULL,
    invite_resends     INTEGER     NOT NULL DEFAULT 0 CHECK (invite_resends >= 0),
    activated_at       TIMESTAMPTZ,
    last_login_at      TIMESTAMPTZ,
    login_count        INTEGER     NOT NULL DEFAULT 0 CHECK (login_count >= 0),
    disabled_at        TIMESTAMPTZ,
    disabled_reason    TEXT,
    version            INTEGER     NOT NULL DEFAULT 1,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    -- One portal identity per mailbox per tenant.
    UNIQUE (tenant_id, email),
    CHECK (invite_expires_at > invited_at),
    CHECK (status <> 'active' OR activated_at IS NOT NULL),
    CHECK (status <> 'disabled' OR (disabled_at IS NOT NULL AND disabled_reason IS NOT NULL)),
    CHECK (login_count = 0 OR last_login_at IS NOT NULL)
);
CREATE INDEX prmc_portal_users_partner_idx ON prmc_portal_users (tenant_id, partner_id, status);
CREATE INDEX prmc_portal_users_roles_idx   ON prmc_portal_users USING GIN (roles);

-- Enablement records point at a person; wire the references now that the
-- portal user table exists.
ALTER TABLE prmc_enrollments
    ADD CONSTRAINT prmc_enrollments_portal_user_fk
    FOREIGN KEY (portal_user_id) REFERENCES prmc_portal_users (id) ON DELETE CASCADE;

ALTER TABLE prmc_certifications
    ADD CONSTRAINT prmc_certifications_portal_user_fk
    FOREIGN KEY (portal_user_id) REFERENCES prmc_portal_users (id) ON DELETE CASCADE;

CREATE TABLE prmc_entitlement_definitions (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    code        TEXT        NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,40}$'),
    name        TEXT        NOT NULL CHECK (length(name) >= 1),
    description TEXT,
    category    TEXT        NOT NULL CHECK (category IN (
        'sales', 'marketing', 'support', 'training', 'finance', 'product')),
    --   {"minTierRank"?, "anyOfRoles"?, "requiredUserCertifications"?,
    --    "requiredPartnerCertifications"?, "requiresAnyContractType"?,
    --    "allowedPartnerStatuses"?}   — an empty policy means "any active partner"
    policy      JSONB       NOT NULL DEFAULT '{}',
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    CHECK (policy ->> 'minTierRank' IS NULL OR (policy ->> 'minTierRank')::INTEGER >= 0)
);

CREATE TABLE prmc_entitlement_grants (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    entitlement_code  TEXT        NOT NULL,
    subject           TEXT        NOT NULL CHECK (subject IN ('partner', 'user')),
    -- Points at prmc_partners.id or prmc_portal_users.id depending on subject,
    -- so the reference is checked in the application rather than by an FK.
    subject_id        TEXT        NOT NULL,
    effect            TEXT        NOT NULL CHECK (effect IN ('allow', 'deny')),
    -- An override always says why; support answers "who gave me this?" from here.
    reason            TEXT        NOT NULL CHECK (length(reason) >= 1),
    granted_by        TEXT        NOT NULL,
    granted_at        TIMESTAMPTZ NOT NULL,
    expires_at        TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    CHECK (expires_at IS NULL OR expires_at > granted_at),
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
-- One live override of each effect per subject and entitlement.
CREATE UNIQUE INDEX prmc_entitlement_grants_live_idx
    ON prmc_entitlement_grants (tenant_id, entitlement_code, subject, subject_id, effect)
    WHERE revoked_at IS NULL;
CREATE INDEX prmc_entitlement_grants_subject_idx
    ON prmc_entitlement_grants (tenant_id, subject, subject_id)
    WHERE revoked_at IS NULL;
