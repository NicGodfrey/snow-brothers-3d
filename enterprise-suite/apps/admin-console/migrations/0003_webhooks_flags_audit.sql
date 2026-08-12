-- Webhooks, feature flags and the audit log.
--
-- The delivery table is a queue: `next_attempt_at` is the only thing a worker
-- orders by, and the partial index below keeps that scan proportional to the
-- backlog rather than to delivery history, which grows without bound.

CREATE TABLE IF NOT EXISTS admin_webhook (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT        NOT NULL REFERENCES admin_tenant (key) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  url                   TEXT        NOT NULL,
  status                TEXT        NOT NULL CHECK (status IN ('active', 'paused', 'disabled')),
  -- Glob patterns such as 'admin.user.*'; matched in the application.
  event_filters         TEXT[]      NOT NULL DEFAULT '{}',
  headers               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Shown once at creation and on rotation; stored for signing, never returned.
  secret                TEXT        NOT NULL,
  secret_rotated_at     TIMESTAMPTZ,
  max_attempts          INTEGER     NOT NULL DEFAULT 5,
  initial_backoff_ms    INTEGER     NOT NULL DEFAULT 30000,
  backoff_factor        NUMERIC(4,2) NOT NULL DEFAULT 3.0,
  consecutive_failures  INTEGER     NOT NULL DEFAULT 0,
  total_deliveries      BIGINT      NOT NULL DEFAULT 0,
  total_failures        BIGINT      NOT NULL DEFAULT 0,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  pause_reason          TEXT,
  version               INTEGER     NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_webhook_https CHECK (url LIKE 'https://%' OR url LIKE 'http://localhost%'),
  CONSTRAINT admin_webhook_filters CHECK (cardinality(event_filters) > 0),
  CONSTRAINT admin_webhook_attempts CHECK (max_attempts BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS admin_webhook_tenant_idx ON admin_webhook (tenant_id, status);

CREATE TABLE IF NOT EXISTS admin_webhook_delivery (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  webhook_id      TEXT        NOT NULL REFERENCES admin_webhook (id) ON DELETE CASCADE,
  event_id        TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'dead')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_status     INTEGER,
  last_error      TEXT,
  history         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The queue scan. Only pending rows are ever claimed.
CREATE INDEX IF NOT EXISTS admin_webhook_delivery_due_idx
  ON admin_webhook_delivery (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS admin_webhook_delivery_webhook_idx
  ON admin_webhook_delivery (webhook_id, created_at DESC);
-- One delivery per subscription per event, so a replayed outbox is harmless.
CREATE UNIQUE INDEX IF NOT EXISTS admin_webhook_delivery_dedupe_idx
  ON admin_webhook_delivery (webhook_id, event_id);

CREATE TABLE IF NOT EXISTS admin_feature_flag (
  tenant_id           TEXT        NOT NULL REFERENCES admin_tenant (key) ON DELETE CASCADE,
  key                 TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  description         TEXT,
  value_type          TEXT        NOT NULL CHECK (value_type IN ('boolean', 'string', 'number')),
  enabled             BOOLEAN     NOT NULL DEFAULT FALSE,
  default_value       JSONB       NOT NULL,
  on_value            JSONB       NOT NULL,
  off_value           JSONB       NOT NULL,
  rollout_percentage  INTEGER     NOT NULL DEFAULT 100,
  tags                TEXT[]      NOT NULL DEFAULT '{}',
  archived            BOOLEAN     NOT NULL DEFAULT FALSE,
  version             INTEGER     NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT admin_feature_flag_key_shape CHECK (key ~ '^[a-z][a-z0-9-]{1,46}[a-z0-9]$'),
  CONSTRAINT admin_feature_flag_rollout CHECK (rollout_percentage BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS admin_feature_flag_rule (
  tenant_id   TEXT    NOT NULL,
  flag_key    TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  description TEXT,
  -- Lower runs first; ties broken by id so evaluation is deterministic.
  priority    INTEGER NOT NULL DEFAULT 100,
  conditions  JSONB   NOT NULL DEFAULT '[]'::jsonb,
  value       JSONB   NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, flag_key, id),
  FOREIGN KEY (tenant_id, flag_key) REFERENCES admin_feature_flag (tenant_id, key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS admin_feature_flag_rule_order_idx
  ON admin_feature_flag_rule (tenant_id, flag_key, priority, id);

CREATE TABLE IF NOT EXISTS admin_audit_entry (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT        NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT        NOT NULL,
  actor_roles   TEXT[]      NOT NULL DEFAULT '{}',
  action        TEXT        NOT NULL,
  resource_type TEXT        NOT NULL,
  resource_id   TEXT        NOT NULL,
  outcome       TEXT        NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  reason        TEXT,
  -- Secrets are stripped before the row is written, not on the way out.
  before_state  JSONB,
  after_state   JSONB,
  request_id    TEXT,
  source_ip     INET
);

CREATE INDEX IF NOT EXISTS admin_audit_entry_tenant_idx ON admin_audit_entry (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_entry_resource_idx
  ON admin_audit_entry (tenant_id, resource_type, resource_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_entry_actor_idx ON admin_audit_entry (tenant_id, actor, at DESC);

-- Append-only: the audit log is evidence, so mutation is blocked in the
-- database rather than trusted to every future caller.
CREATE OR REPLACE RULE admin_audit_entry_no_update AS
  ON UPDATE TO admin_audit_entry DO INSTEAD NOTHING;
CREATE OR REPLACE RULE admin_audit_entry_no_delete AS
  ON DELETE TO admin_audit_entry DO INSTEAD NOTHING;
