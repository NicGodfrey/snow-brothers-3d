-- Groups, group membership and role bindings.

SET search_path TO identity, public;

CREATE TABLE identity.groups (
  id                 text NOT NULL,
  tenant_id          text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(name) >= 2),
  description        text NOT NULL DEFAULT '',
  parent_group_id    text,
  -- Groups synced from an external directory are read-only for local membership edits.
  externally_managed boolean NOT NULL DEFAULT false,
  external_ref       text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_group_id) REFERENCES identity.groups (tenant_id, id)
    ON DELETE SET NULL,
  CONSTRAINT groups_no_self_parent CHECK (parent_group_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX groups_tenant_name_key ON identity.groups (tenant_id, lower(name));
CREATE UNIQUE INDEX groups_id_key ON identity.groups (id);
CREATE INDEX groups_parent_idx ON identity.groups (tenant_id, parent_group_id);

CREATE TRIGGER groups_touch
  BEFORE UPDATE ON identity.groups
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

CREATE TABLE identity.group_members (
  tenant_id  text NOT NULL,
  group_id   text NOT NULL,
  user_id    text NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  added_by   text,

  PRIMARY KEY (tenant_id, group_id, user_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES identity.groups (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX group_members_user_idx ON identity.group_members (tenant_id, user_id);

-- Binds one role to one subject at one scope for a time window. Everything about
-- "who can do what" is this table joined to role_effective_grants.
CREATE TABLE identity.role_bindings (
  id             text NOT NULL,
  tenant_id      text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  subject_type   identity.subject_type NOT NULL,
  subject_id     text NOT NULL,
  role_id        text NOT NULL,
  role_code      identity.role_code NOT NULL,
  scope          identity.scope_path NOT NULL DEFAULT 'tenant',
  status         identity.binding_status NOT NULL DEFAULT 'active',

  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  -- When true the holder may pass the role on at the same or a narrower scope.
  delegable      boolean NOT NULL DEFAULT false,

  granted_by     text,
  reason         text,
  revoked_at     timestamptz,
  revoked_by     text,
  revoked_reason text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.roles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT role_bindings_window CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT role_bindings_revoked_has_timestamp
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX role_bindings_id_key ON identity.role_bindings (id);

-- One active binding per (subject, role, scope); revoked rows are kept for audit and
-- are excluded from the constraint by the partial index.
CREATE UNIQUE INDEX role_bindings_active_key
  ON identity.role_bindings (tenant_id, subject_type, subject_id, role_id, scope)
  WHERE status = 'active';

CREATE INDEX role_bindings_subject_idx
  ON identity.role_bindings (tenant_id, subject_type, subject_id)
  WHERE status = 'active';
CREATE INDEX role_bindings_role_idx ON identity.role_bindings (tenant_id, role_id);
CREATE INDEX role_bindings_scope_idx ON identity.role_bindings (tenant_id, scope);
-- Drives the "expiring soon" report and the expiry sweep.
CREATE INDEX role_bindings_expiry_idx ON identity.role_bindings (tenant_id, valid_until)
  WHERE status = 'active' AND valid_until IS NOT NULL;

CREATE TRIGGER role_bindings_touch
  BEFORE UPDATE ON identity.role_bindings
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

-- Bindings that apply to a user, including the ones reached through group membership
-- and nested parent groups.
CREATE OR REPLACE VIEW identity.user_effective_bindings AS
WITH RECURSIVE user_groups AS (
  SELECT gm.tenant_id, gm.user_id, gm.group_id, 0 AS depth
  FROM identity.group_members gm
  UNION ALL
  SELECT ug.tenant_id, ug.user_id, g.parent_group_id, ug.depth + 1
  FROM user_groups ug
  JOIN identity.groups g ON g.tenant_id = ug.tenant_id AND g.id = ug.group_id
  WHERE g.parent_group_id IS NOT NULL AND ug.depth < 16
)
SELECT b.tenant_id, u.id AS user_id, b.id AS binding_id, b.role_id, b.role_code, b.scope,
       b.status, b.valid_from, b.valid_until, 'direct' AS source
FROM identity.users u
JOIN identity.role_bindings b
  ON b.tenant_id = u.tenant_id AND b.subject_type = 'user' AND b.subject_id = u.id
UNION ALL
SELECT b.tenant_id, ug.user_id, b.id, b.role_id, b.role_code, b.scope,
       b.status, b.valid_from, b.valid_until, 'group:' || ug.group_id
FROM user_groups ug
JOIN identity.role_bindings b
  ON b.tenant_id = ug.tenant_id AND b.subject_type = 'group' AND b.subject_id = ug.group_id;
