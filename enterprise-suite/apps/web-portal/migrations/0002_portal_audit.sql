-- Web portal: navigation and command audit.
-- Records what a user opened and which module command the shell dispatched on
-- their behalf. Read models for adoption reporting live in reporting-bi; this
-- table is the raw source and is retained for 90 days.

CREATE TABLE portal_activity (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     TEXT        NOT NULL,
  user_id       TEXT        NOT NULL,
  session_id    TEXT        NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT        NOT NULL,
  module_key    TEXT,
  path          TEXT        NOT NULL,
  action_key    TEXT,
  status        SMALLINT    NOT NULL,
  duration_ms   INTEGER     NOT NULL,
  request_id    TEXT        NOT NULL,
  on_behalf_of  TEXT,
  CONSTRAINT ck_portal_activity_kind CHECK (kind IN ('page', 'command', 'search', 'sign-in', 'switch-tenant'))
);

CREATE INDEX ix_portal_activity_tenant_time ON portal_activity (tenant_id, occurred_at DESC);
CREATE INDEX ix_portal_activity_module ON portal_activity (tenant_id, module_key, occurred_at DESC);

-- Outbound calls the portal made to domain services, for latency attribution
-- when a screen is slow. Mirrors the in-memory CallLog.
CREATE TABLE portal_service_call (
  id           BIGSERIAL   PRIMARY KEY,
  tenant_id    TEXT        NOT NULL,
  service      TEXT        NOT NULL,
  method       TEXT        NOT NULL,
  path         TEXT        NOT NULL,
  status       SMALLINT    NOT NULL,
  duration_ms  INTEGER     NOT NULL,
  attempts     SMALLINT    NOT NULL DEFAULT 1,
  request_id   TEXT        NOT NULL,
  error        TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_portal_service_call_service_time ON portal_service_call (service, occurred_at DESC);
CREATE INDEX ix_portal_service_call_errors ON portal_service_call (tenant_id, occurred_at DESC)
  WHERE error IS NOT NULL;
