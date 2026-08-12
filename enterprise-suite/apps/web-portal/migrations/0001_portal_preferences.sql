-- Web portal: per-user shell state.
-- The portal owns no business data; these tables exist only so the shell can
-- remember how a user has arranged it. Everything is tenant-scoped.

CREATE TABLE portal_preferences (
  tenant_id       TEXT        NOT NULL,
  user_id         TEXT        NOT NULL,
  landing_module  TEXT,
  density         TEXT        NOT NULL DEFAULT 'comfortable',
  theme           TEXT        NOT NULL DEFAULT 'system',
  locale          TEXT        NOT NULL DEFAULT 'en-US',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_portal_preferences PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT ck_portal_preferences_density CHECK (density IN ('comfortable', 'compact')),
  CONSTRAINT ck_portal_preferences_theme CHECK (theme IN ('system', 'light', 'dark')),
  CONSTRAINT ck_portal_preferences_module CHECK (
    landing_module IS NULL
    OR landing_module IN ('sales', 'marketing', 'inventory', 'srm', 'prm', 'finance')
  )
);

-- Pins are ordered: position drives the rail order, capped at four in the
-- domain layer and enforced here per (tenant, user).
CREATE TABLE portal_pinned_module (
  tenant_id   TEXT        NOT NULL,
  user_id     TEXT        NOT NULL,
  module_key  TEXT        NOT NULL,
  position    SMALLINT    NOT NULL,
  pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_portal_pinned_module PRIMARY KEY (tenant_id, user_id, module_key),
  CONSTRAINT fk_portal_pinned_module_prefs
    FOREIGN KEY (tenant_id, user_id) REFERENCES portal_preferences (tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_portal_pinned_module_position CHECK (position BETWEEN 0 AND 3),
  CONSTRAINT uq_portal_pinned_module_position UNIQUE (tenant_id, user_id, position)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE portal_saved_view (
  id          TEXT        NOT NULL,
  tenant_id   TEXT        NOT NULL,
  user_id     TEXT        NOT NULL,
  module_key  TEXT        NOT NULL,
  resource    TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  query       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_portal_saved_view PRIMARY KEY (id),
  CONSTRAINT fk_portal_saved_view_prefs
    FOREIGN KEY (tenant_id, user_id) REFERENCES portal_preferences (tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_portal_saved_view_name UNIQUE (tenant_id, user_id, module_key, name)
);

CREATE INDEX ix_portal_saved_view_owner ON portal_saved_view (tenant_id, user_id, module_key);
