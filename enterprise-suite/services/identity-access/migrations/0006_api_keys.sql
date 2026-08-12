-- API keys. Presented as `esk_<prefix>_<secret>`: the prefix is stored in clear so a
-- lookup is one indexed read, the secret only ever as a salted digest.

SET search_path TO identity, public;

CREATE TABLE identity.api_keys (
  id              text NOT NULL,
  tenant_id       text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) >= 3),
  prefix          text NOT NULL CHECK (prefix ~ '^[a-z0-9_-]{6,32}$'),

  secret_algorithm text NOT NULL DEFAULT 'sha256' CHECK (secret_algorithm IN ('sha256')),
  secret_salt      text NOT NULL,
  secret_hash      text NOT NULL,

  status          identity.api_key_status NOT NULL DEFAULT 'active',
  -- Scope-down list: when non-empty the key can never exercise a permission outside
  -- these patterns, however wide its role bindings are.
  restrictions    identity.grant_pattern[] NOT NULL DEFAULT '{}',
  -- Exact addresses or `a.b.c.*` wildcards; empty means any source address.
  ip_allowlist    text[] NOT NULL DEFAULT '{}',

  expires_at      timestamptz,
  last_used_at    timestamptz,
  use_count       bigint NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  rotated_at      timestamptz,

  created_by      text,
  revoked_at      timestamptz,
  revoked_by      text,
  revoked_reason  text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT api_keys_revoked_has_timestamp
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

-- Prefixes are globally unique: a presented token does not carry a tenant, so the
-- prefix alone has to identify the row.
CREATE UNIQUE INDEX api_keys_prefix_key ON identity.api_keys (prefix);
CREATE UNIQUE INDEX api_keys_id_key ON identity.api_keys (id);
CREATE INDEX api_keys_tenant_active_idx ON identity.api_keys (tenant_id)
  WHERE status = 'active';
CREATE INDEX api_keys_expiry_idx ON identity.api_keys (tenant_id, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TRIGGER api_keys_touch
  BEFORE UPDATE ON identity.api_keys
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

-- Enforces tenants.api_key_policy.maxActiveKeys at the database level so a race between
-- two concurrent issue calls cannot exceed the cap.
CREATE OR REPLACE FUNCTION identity.enforce_api_key_limit() RETURNS trigger AS $$
DECLARE
  max_keys integer;
  active_keys integer;
BEGIN
  SELECT COALESCE((api_key_policy ->> 'maxActiveKeys')::int, 25)
  INTO max_keys
  FROM identity.tenants
  WHERE tenant_id = NEW.tenant_id;

  SELECT count(*) INTO active_keys
  FROM identity.api_keys
  WHERE tenant_id = NEW.tenant_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  IF active_keys > max_keys THEN
    RAISE EXCEPTION 'API_KEY_LIMIT_REACHED: tenant % already has % active keys',
      NEW.tenant_id, max_keys;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER api_keys_limit
  AFTER INSERT ON identity.api_keys
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION identity.enforce_api_key_limit();
