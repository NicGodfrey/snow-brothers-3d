-- Gateway configuration: upstream catalog and route table.
--
-- The reference deployment boots from code (src/infrastructure/catalog.ts and
-- routes.ts). These tables let an operator override that configuration at
-- runtime without a redeploy; the process reloads on notify.

CREATE TABLE IF NOT EXISTS gateway_upstream_service (
  id                TEXT PRIMARY KEY,
  label             TEXT        NOT NULL,
  system            TEXT        NOT NULL CHECK (system IN ('ERP', 'SRM', 'PRM', 'Platform', 'Apps')),
  base_url          TEXT        NOT NULL,
  prefix            TEXT        NOT NULL UNIQUE,
  version           TEXT        NOT NULL DEFAULT '0.1.0',
  critical          BOOLEAN     NOT NULL DEFAULT FALSE,
  planned           BOOLEAN     NOT NULL DEFAULT FALSE,
  health_path       TEXT        NOT NULL DEFAULT '/health',
  ready_path        TEXT        NOT NULL DEFAULT '/health/ready',
  openapi_path      TEXT        NOT NULL DEFAULT '/openapi.json',
  owner             TEXT,
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gateway_upstream_prefix_shape CHECK (prefix LIKE '/%' AND prefix NOT LIKE '%/')
);

CREATE TABLE IF NOT EXISTS gateway_route (
  id                TEXT PRIMARY KEY,
  method            TEXT        NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
  pattern           TEXT        NOT NULL,
  -- Method-independent identity: ':id' collapsed to '{}' for conflict checks.
  signature         TEXT        NOT NULL,
  upstream_id       TEXT        NOT NULL REFERENCES gateway_upstream_service (id) ON DELETE CASCADE,
  rewrite           TEXT,
  auth_mode         TEXT        NOT NULL CHECK (auth_mode IN ('anonymous', 'tenant', 'roles')),
  any_of_roles      TEXT[]      NOT NULL DEFAULT '{}',
  all_of_permissions TEXT[]     NOT NULL DEFAULT '{}',
  rate_limit        INTEGER,
  rate_window_ms    INTEGER,
  rate_key          TEXT        CHECK (rate_key IN ('global', 'tenant', 'tenant-user', 'tenant-route')),
  timeout_ms        INTEGER     NOT NULL DEFAULT 10000,
  summary           TEXT,
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  deprecated        BOOLEAN     NOT NULL DEFAULT FALSE,
  expose_in_openapi BOOLEAN     NOT NULL DEFAULT TRUE,
  idempotent        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gateway_route_unique_signature UNIQUE (method, signature),
  CONSTRAINT gateway_route_rate_pair CHECK (
    (rate_limit IS NULL AND rate_window_ms IS NULL AND rate_key IS NULL)
    OR (rate_limit > 0 AND rate_window_ms > 0 AND rate_key IS NOT NULL)
  ),
  CONSTRAINT gateway_route_roles_require_mode CHECK (
    auth_mode = 'roles' OR cardinality(any_of_roles) = 0
  )
);

CREATE INDEX IF NOT EXISTS gateway_route_upstream_idx ON gateway_route (upstream_id);
CREATE INDEX IF NOT EXISTS gateway_route_pattern_idx ON gateway_route (pattern);

-- Role -> permission grants consulted when a route declares all_of_permissions.
CREATE TABLE IF NOT EXISTS gateway_role_grant (
  role_code   TEXT NOT NULL,
  permission  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission)
);
