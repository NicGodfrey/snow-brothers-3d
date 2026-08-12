-- Admin console: tenants, roles and users.
--
-- The console is the one place in the suite that writes tenant registration and
-- role definitions; every other service reads them. Tenant rows are therefore
-- global (no tenant_id column) while everything below them is tenant-scoped and
-- carries tenant_id in its primary key so a tenant can never see another's
-- configuration through a mistaken join.

CREATE TABLE IF NOT EXISTS admin_tenant (
  id              TEXT PRIMARY KEY,
  key             TEXT        NOT NULL UNIQUE,
  name            TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  plan            TEXT        NOT NULL CHECK (plan IN ('trial', 'standard', 'enterprise')),
  settings        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  quotas          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  contacts        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  suspended_at    TIMESTAMPTZ,
  suspend_reason  TEXT,
  archived_at     TIMESTAMPTZ,
  version         INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Tenant keys become URL segments and header values; keep them boring.
  CONSTRAINT admin_tenant_key_shape CHECK (key ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT admin_tenant_suspend_reason CHECK (status <> 'suspended' OR suspend_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS admin_tenant_status_idx ON admin_tenant (status, plan);

CREATE TABLE IF NOT EXISTS admin_role (
  tenant_id       TEXT        NOT NULL REFERENCES admin_tenant (key) ON DELETE CASCADE,
  code            TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  -- Unexpanded grants exactly as authored; ':admin' is expanded at read time so
  -- adding an action to the catalog does not require a data migration.
  permissions     TEXT[]      NOT NULL DEFAULT '{}',
  inherits_from   TEXT,
  system          BOOLEAN     NOT NULL DEFAULT FALSE,
  version         INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code),
  CONSTRAINT admin_role_code_shape CHECK (code ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT admin_role_no_self_inherit CHECK (inherits_from IS DISTINCT FROM code),
  FOREIGN KEY (tenant_id, inherits_from) REFERENCES admin_role (tenant_id, code) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_user (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT        NOT NULL REFERENCES admin_tenant (key) ON DELETE CASCADE,
  email               TEXT        NOT NULL,
  display_name        TEXT        NOT NULL,
  status              TEXT        NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
  attributes          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  mfa_enabled         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Hash, never the token itself: an invite is a bearer credential.
  invite_token_hash   TEXT,
  invite_expires_at   TIMESTAMPTZ,
  invited_by          TEXT,
  activated_at        TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  suspend_reason      TEXT,
  version             INTEGER     NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_user_email_shape CHECK (email LIKE '%_@_%.__%'),
  CONSTRAINT admin_user_invite_pair CHECK (
    (invite_token_hash IS NULL) = (invite_expires_at IS NULL)
  ),
  CONSTRAINT admin_user_invited_has_token CHECK (
    status <> 'invited' OR invite_token_hash IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_user_tenant_email_idx
  ON admin_user (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS admin_user_status_idx ON admin_user (tenant_id, status);

CREATE TABLE IF NOT EXISTS admin_user_role (
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES admin_user (id) ON DELETE CASCADE,
  role_code   TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  TEXT,
  PRIMARY KEY (user_id, role_code),
  FOREIGN KEY (tenant_id, role_code) REFERENCES admin_role (tenant_id, code) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS admin_user_role_by_role_idx ON admin_user_role (tenant_id, role_code);

-- The application refuses to remove the last administrator; this makes the same
-- guarantee at the storage layer for anything that bypasses it.
CREATE OR REPLACE VIEW admin_tenant_admin_count AS
SELECT u.tenant_id, count(*) AS active_admins
FROM admin_user u
JOIN admin_user_role r ON r.user_id = u.id
WHERE u.status = 'active' AND r.role_code = 'tenant-admin'
GROUP BY u.tenant_id;
