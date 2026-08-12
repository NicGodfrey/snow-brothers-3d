-- Tenants and their policy settings.

SET search_path TO identity, public;

CREATE TABLE identity.tenants (
  tenant_id          text PRIMARY KEY,
  slug               text NOT NULL,
  name               text NOT NULL CHECK (length(name) >= 2),
  status             identity.tenant_status NOT NULL DEFAULT 'pending',
  suspended_reason   text,
  activated_at       timestamptz,
  archived_at        timestamptz,

  -- Policy documents are stored as JSONB: they are read whole, written whole, and their
  -- shape evolves faster than a column-per-setting layout could keep up with.
  password_policy    jsonb NOT NULL DEFAULT '{
    "minLength": 12, "requireUppercase": true, "requireLowercase": true,
    "requireDigit": true, "requireSymbol": false, "historySize": 5, "maxAgeDays": 365
  }'::jsonb,
  session_policy     jsonb NOT NULL DEFAULT '{
    "idleTtlSeconds": 3600, "absoluteTtlSeconds": 43200, "maxConcurrentSessions": 10,
    "refreshEnabled": true, "rotateOnRefresh": true
  }'::jsonb,
  api_key_policy     jsonb NOT NULL DEFAULT '{
    "maxActiveKeys": 25, "defaultTtlDays": 365, "enforceIpAllowlist": true
  }'::jsonb,
  lockout_policy     jsonb NOT NULL DEFAULT '{
    "maxFailedAttempts": 5, "lockoutSeconds": 900, "attemptWindowSeconds": 900
  }'::jsonb,
  mfa_required            boolean NOT NULL DEFAULT false,
  allowed_email_domains   text[] NOT NULL DEFAULT '{}',
  audit_all_decisions     boolean NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,

  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$'),
  CONSTRAINT tenants_archived_has_timestamp
    CHECK (status <> 'archived' OR archived_at IS NOT NULL)
);

CREATE UNIQUE INDEX tenants_slug_key ON identity.tenants (slug);
CREATE INDEX tenants_status_idx ON identity.tenants (status) WHERE status <> 'archived';

CREATE TRIGGER tenants_touch
  BEFORE UPDATE ON identity.tenants
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

-- Monotonic counter bumped by any change to roles, bindings or group membership.
-- Authorization caches key on it, so a policy edit invalidates them tenant-wide.
CREATE TABLE identity.policy_versions (
  tenant_id  text PRIMARY KEY REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  version    bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION identity.bump_policy_version(p_tenant_id text)
RETURNS bigint AS $$
DECLARE
  next_version bigint;
BEGIN
  INSERT INTO identity.policy_versions (tenant_id, version)
  VALUES (p_tenant_id, 2)
  ON CONFLICT (tenant_id)
  DO UPDATE SET version = identity.policy_versions.version + 1, updated_at = now()
  RETURNING version INTO next_version;
  RETURN next_version;
END;
$$ LANGUAGE plpgsql;
