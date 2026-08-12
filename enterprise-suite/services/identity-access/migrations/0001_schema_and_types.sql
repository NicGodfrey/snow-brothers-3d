-- Identity & Access — schema, enums and shared helpers.
-- Every table in this context is tenant-scoped; `tenant_id` is the leading column of
-- each primary or unique key so a tenant's rows stay physically clustered together.

CREATE SCHEMA IF NOT EXISTS identity;

SET search_path TO identity, public;

CREATE TYPE identity.tenant_status AS ENUM ('pending', 'active', 'suspended', 'archived');
CREATE TYPE identity.user_status AS ENUM ('invited', 'active', 'suspended', 'deactivated');
CREATE TYPE identity.subject_type AS ENUM ('user', 'group', 'api_key', 'service');
CREATE TYPE identity.grant_effect AS ENUM ('allow', 'deny');
CREATE TYPE identity.binding_status AS ENUM ('active', 'revoked');
CREATE TYPE identity.api_key_status AS ENUM ('active', 'revoked');
CREATE TYPE identity.session_status AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE identity.audit_category AS ENUM ('authz', 'authn', 'admin');
CREATE TYPE identity.audit_outcome AS ENUM ('allow', 'deny', 'success', 'failure');
CREATE TYPE identity.mfa_method AS ENUM ('totp', 'webauthn', 'sms');

-- Permission keys are `<resource>:<action>`; grant patterns additionally allow `*`
-- (one segment) and a trailing `**` (any depth). Validated here so a bad grant cannot
-- reach the table even if it bypasses the application.
CREATE DOMAIN identity.permission_key AS text
  CHECK (VALUE ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*:[a-z][a-z0-9_]*$');

CREATE DOMAIN identity.grant_pattern AS text
  CHECK (VALUE ~ '^(\*\*|\*|[a-z][a-z0-9_]*)(\.(\*\*|\*|[a-z][a-z0-9_]*))*:(\*|[a-z][a-z0-9_]*)$');

-- Scope paths are `tenant` or `tenant/type:key[/type:key...]`.
CREATE DOMAIN identity.scope_path AS text
  CHECK (VALUE = 'tenant' OR VALUE ~ '^tenant(/[a-z][a-z0-9_]*:([a-z0-9][a-z0-9._-]*|\*))+$');

CREATE DOMAIN identity.role_code AS text CHECK (VALUE ~ '^[a-z][a-z0-9_]{1,63}$');

-- Every mutating statement should bump `updated_at`; a trigger keeps that honest.
CREATE OR REPLACE FUNCTION identity.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- True when a grant held at `granted` applies to a request made at `requested`.
-- Mirrors `scopeCovers` in src/domain/scope.ts; used by reporting views, not by the
-- hot authorization path (which evaluates in the application).
CREATE OR REPLACE FUNCTION identity.scope_covers(granted text, requested text)
RETURNS boolean AS $$
DECLARE
  g text[];
  r text[];
  i int;
  g_type text;
  g_key text;
  r_type text;
  r_key text;
BEGIN
  IF granted = 'tenant' THEN RETURN true; END IF;
  g := string_to_array(granted, '/');
  r := string_to_array(requested, '/');
  IF array_length(g, 1) > array_length(r, 1) THEN RETURN false; END IF;
  FOR i IN 2 .. array_length(g, 1) LOOP
    g_type := split_part(g[i], ':', 1);
    g_key := split_part(g[i], ':', 2);
    r_type := split_part(r[i], ':', 1);
    r_key := split_part(r[i], ':', 2);
    IF g_type <> r_type THEN RETURN false; END IF;
    IF g_key <> '*' AND g_key <> r_key THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
