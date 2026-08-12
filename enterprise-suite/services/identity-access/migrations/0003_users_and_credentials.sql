-- Users, their password material and second factors.
-- Derived material only: no column in this file can be reversed into a secret.

SET search_path TO identity, public;

CREATE TABLE identity.users (
  id                    text NOT NULL,
  tenant_id             text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  email                 text NOT NULL,
  display_name          text NOT NULL CHECK (length(display_name) >= 2),
  status                identity.user_status NOT NULL DEFAULT 'invited',

  -- Current password. Split into columns rather than JSONB because the verifier reads
  -- every field on the hot login path and the parameters must stay queryable for
  -- "who is still on the old iteration count?" style rehash sweeps.
  password_algorithm    text CHECK (password_algorithm IN ('pbkdf2-sha512', 'argon2id')),
  password_iterations   integer CHECK (password_iterations IS NULL OR password_iterations >= 1000),
  password_salt         text,
  password_hash         text,
  password_updated_at   timestamptz,
  must_change_password  boolean NOT NULL DEFAULT false,

  failed_attempts       integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  last_failed_at        timestamptz,
  locked_until          timestamptz,
  last_login_at         timestamptz,

  invited_by            text,
  invited_at            timestamptz,
  activated_at          timestamptz,
  suspended_reason      text,
  -- Attributes feed scope resolution (e.g. {"bu": "emea"}); intentionally free-form.
  attributes            jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT users_email_format CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  CONSTRAINT users_active_needs_password
    CHECK (status <> 'active' OR password_hash IS NOT NULL),
  CONSTRAINT users_password_fields_together CHECK (
    (password_hash IS NULL AND password_salt IS NULL AND password_algorithm IS NULL)
    OR (password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_algorithm IS NOT NULL)
  )
);

CREATE UNIQUE INDEX users_tenant_email_key ON identity.users (tenant_id, lower(email));
CREATE UNIQUE INDEX users_id_key ON identity.users (id);
CREATE INDEX users_tenant_status_idx ON identity.users (tenant_id, status);
CREATE INDEX users_locked_idx ON identity.users (tenant_id, locked_until)
  WHERE locked_until IS NOT NULL;
CREATE INDEX users_attributes_idx ON identity.users USING gin (attributes);

CREATE TRIGGER users_touch
  BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

-- Previous password hashes, newest first by `position`. Kept to enforce
-- passwordPolicy.historySize; trimmed by the application on every change.
CREATE TABLE identity.user_password_history (
  tenant_id           text NOT NULL,
  user_id             text NOT NULL,
  position            smallint NOT NULL CHECK (position >= 0),
  password_algorithm  text NOT NULL,
  password_iterations integer NOT NULL,
  password_salt       text NOT NULL,
  password_hash       text NOT NULL,
  retired_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, user_id, position),
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.users (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE identity.user_mfa_enrollments (
  tenant_id        text NOT NULL,
  user_id          text NOT NULL,
  method           identity.mfa_method NOT NULL,
  label            text NOT NULL,
  -- Digest of the shared secret or credential id; the secret itself never leaves the
  -- enrolling device.
  secret_hash      text NOT NULL,
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,

  PRIMARY KEY (tenant_id, user_id, method, label),
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX user_mfa_user_idx ON identity.user_mfa_enrollments (tenant_id, user_id);
