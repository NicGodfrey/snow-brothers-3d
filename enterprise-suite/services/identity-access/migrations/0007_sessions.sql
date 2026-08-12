-- Session tokens. Two deadlines per session: a sliding idle deadline that moves on use,
-- and an absolute deadline fixed at issue time that nothing extends.

SET search_path TO identity, public;

CREATE TABLE identity.sessions (
  id                   text NOT NULL,
  tenant_id            text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  user_id              text NOT NULL,

  token_algorithm      text NOT NULL DEFAULT 'sha256' CHECK (token_algorithm IN ('sha256')),
  token_salt           text NOT NULL,
  token_hash           text NOT NULL,
  refresh_token_salt   text,
  refresh_token_hash   text,

  status               identity.session_status NOT NULL DEFAULT 'active',
  issued_at            timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  refresh_count        integer NOT NULL DEFAULT 0 CHECK (refresh_count >= 0),

  -- Authentication methods, in the spirit of the OIDC `amr` claim.
  amr                  text[] NOT NULL DEFAULT '{}',
  mfa_satisfied        boolean NOT NULL DEFAULT false,
  user_agent           text,
  ip                   inet,
  device_label         text,
  impersonated_by      text,

  revoked_at           timestamptz,
  revoked_reason       text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT sessions_idle_within_absolute CHECK (expires_at <= absolute_expires_at),
  CONSTRAINT sessions_refresh_pair_together CHECK (
    (refresh_token_hash IS NULL AND refresh_token_salt IS NULL)
    OR (refresh_token_hash IS NOT NULL AND refresh_token_salt IS NOT NULL)
  ),
  CONSTRAINT sessions_revoked_has_timestamp
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

-- Presented tokens carry the session id but not the tenant, so the id index is global.
CREATE UNIQUE INDEX sessions_id_key ON identity.sessions (id);
CREATE INDEX sessions_user_idx ON identity.sessions (tenant_id, user_id)
  WHERE status = 'active';
-- Drives the expiry sweep and the concurrency cap.
CREATE INDEX sessions_expiry_idx ON identity.sessions (expires_at) WHERE status = 'active';
CREATE INDEX sessions_last_seen_idx ON identity.sessions (tenant_id, user_id, last_seen_at)
  WHERE status = 'active';
CREATE INDEX sessions_impersonation_idx ON identity.sessions (tenant_id, impersonated_by)
  WHERE impersonated_by IS NOT NULL;

CREATE TRIGGER sessions_touch
  BEFORE UPDATE ON identity.sessions
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

-- Marks lapsed sessions so listings stay honest without a per-read time comparison.
-- A scheduled job calls this per tenant; the application does the same in-process.
CREATE OR REPLACE FUNCTION identity.sweep_expired_sessions(p_tenant_id text)
RETURNS integer AS $$
DECLARE
  swept integer;
BEGIN
  WITH lapsed AS (
    UPDATE identity.sessions
    SET status = 'expired'
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND (expires_at <= now() OR absolute_expires_at <= now())
    RETURNING 1
  )
  SELECT count(*) INTO swept FROM lapsed;
  RETURN swept;
END;
$$ LANGUAGE plpgsql;
