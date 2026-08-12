-- Permission catalog, roles, role grants and role inheritance.

SET search_path TO identity, public;

-- The catalog is global: permissions are declared by the code that enforces them, not
-- by tenants. Tenants compose them into roles.
CREATE TABLE identity.permissions (
  key          identity.permission_key PRIMARY KEY,
  resource     text NOT NULL,
  action       text NOT NULL,
  description  text NOT NULL,
  category     text NOT NULL,
  scopable     boolean NOT NULL DEFAULT true,
  dangerous    boolean NOT NULL DEFAULT false,
  registered_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT permissions_key_parts CHECK (key = resource || ':' || action)
);

CREATE INDEX permissions_category_idx ON identity.permissions (category);
CREATE INDEX permissions_resource_idx ON identity.permissions (resource);

CREATE TABLE identity.roles (
  id           text NOT NULL,
  tenant_id    text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  code         identity.role_code NOT NULL,
  name         text NOT NULL CHECK (length(name) >= 2),
  description  text NOT NULL DEFAULT '',
  -- System roles ship with the platform: tenants may clone them but never edit them,
  -- so an upgrade that widens a system role is not silently reverted locally.
  is_system    boolean NOT NULL DEFAULT false,
  -- Non-assignable roles exist only to be inherited by other roles.
  is_assignable boolean NOT NULL DEFAULT true,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1,

  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX roles_tenant_code_key ON identity.roles (tenant_id, code);
CREATE UNIQUE INDEX roles_id_key ON identity.roles (id);
CREATE INDEX roles_assignable_idx ON identity.roles (tenant_id) WHERE is_assignable;

CREATE TRIGGER roles_touch
  BEFORE UPDATE ON identity.roles
  FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

-- One rule inside a role. `scope` narrows the rule relative to the scope the role is
-- bound at, which is how "read everywhere, approve only in EMEA" is expressed.
CREATE TABLE identity.role_grants (
  tenant_id   text NOT NULL,
  role_id     text NOT NULL,
  effect      identity.grant_effect NOT NULL DEFAULT 'allow',
  permission  identity.grant_pattern NOT NULL,
  scope       identity.scope_path NOT NULL DEFAULT 'tenant',
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, role_id, effect, permission, scope),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.roles (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX role_grants_permission_idx ON identity.role_grants (tenant_id, permission);
CREATE INDEX role_grants_deny_idx ON identity.role_grants (tenant_id, role_id)
  WHERE effect = 'deny';

-- Inheritance is a DAG. The self-reference is rejected here; longer cycles are rejected
-- by the application when it flattens the graph (see resolveRole).
CREATE TABLE identity.role_inheritance (
  tenant_id     text NOT NULL,
  role_id       text NOT NULL,
  parent_role_id text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, role_id, parent_role_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.roles (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, parent_role_id) REFERENCES identity.roles (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT role_inheritance_no_self CHECK (role_id <> parent_role_id)
);

CREATE INDEX role_inheritance_parent_idx ON identity.role_inheritance (tenant_id, parent_role_id);

-- Flattened role -> grant view, including inherited grants, with the depth each grant
-- was reached at. Reporting and admin screens read this; the request path does not.
CREATE OR REPLACE VIEW identity.role_effective_grants AS
WITH RECURSIVE ancestry AS (
  SELECT r.tenant_id, r.id AS role_id, r.id AS source_role_id, 0 AS depth
  FROM identity.roles r
  UNION ALL
  SELECT a.tenant_id, a.role_id, ri.parent_role_id, a.depth + 1
  FROM ancestry a
  JOIN identity.role_inheritance ri
    ON ri.tenant_id = a.tenant_id AND ri.role_id = a.source_role_id
  WHERE a.depth < 16
)
SELECT DISTINCT ON (a.tenant_id, a.role_id, g.effect, g.permission, g.scope)
  a.tenant_id,
  a.role_id,
  r.code AS role_code,
  g.effect,
  g.permission,
  g.scope,
  a.source_role_id AS via_role_id,
  a.depth AS inheritance_depth
FROM ancestry a
JOIN identity.role_grants g
  ON g.tenant_id = a.tenant_id AND g.role_id = a.source_role_id
JOIN identity.roles r
  ON r.tenant_id = a.tenant_id AND r.id = a.role_id
ORDER BY a.tenant_id, a.role_id, g.effect, g.permission, g.scope, a.depth;
