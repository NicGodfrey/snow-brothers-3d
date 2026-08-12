-- Reference data: tenant-owned code lists with effective dating.
--
-- Entries are never deleted. A retirement closes the effective window, which is
-- why the read path always filters on a point in time rather than on a boolean:
-- a document raised last quarter must still resolve the code it was raised with.

CREATE TABLE IF NOT EXISTS admin_reference_set (
  tenant_id     TEXT        NOT NULL REFERENCES admin_tenant (key) ON DELETE CASCADE,
  code          TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  description   TEXT,
  status        TEXT        NOT NULL CHECK (status IN ('draft', 'published', 'deprecated')),
  hierarchical  BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Bumped on every entry mutation; consumers cache on (code, revision).
  revision      INTEGER     NOT NULL DEFAULT 1,
  published_at  TIMESTAMPTZ,
  version       INTEGER     NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code),
  CONSTRAINT admin_reference_set_code_shape CHECK (code ~ '^[a-z][a-z0-9-]{1,46}[a-z0-9]$'),
  CONSTRAINT admin_reference_set_published_at CHECK (
    (status = 'draft') = (published_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS admin_reference_entry (
  tenant_id       TEXT        NOT NULL,
  set_code        TEXT        NOT NULL,
  code            TEXT        NOT NULL,
  label           TEXT        NOT NULL,
  description     TEXT,
  parent_code     TEXT,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to    TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, set_code, code),
  FOREIGN KEY (tenant_id, set_code) REFERENCES admin_reference_set (tenant_id, code) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, set_code, parent_code)
    REFERENCES admin_reference_entry (tenant_id, set_code, code) ON DELETE RESTRICT,
  CONSTRAINT admin_reference_entry_window CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT admin_reference_entry_no_self_parent CHECK (parent_code IS DISTINCT FROM code)
);

CREATE INDEX IF NOT EXISTS admin_reference_entry_lookup_idx
  ON admin_reference_entry (tenant_id, set_code, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS admin_reference_entry_parent_idx
  ON admin_reference_entry (tenant_id, set_code, parent_code);

-- What a domain service reads: published sets, entries in force right now.
CREATE OR REPLACE VIEW admin_reference_entry_current AS
SELECT e.tenant_id, e.set_code, e.code, e.label, e.parent_code, e.sort_order, e.metadata
FROM admin_reference_entry e
JOIN admin_reference_set s
  ON s.tenant_id = e.tenant_id AND s.code = e.set_code
WHERE s.status = 'published'
  AND e.active
  AND e.effective_from <= now()
  AND (e.effective_to IS NULL OR e.effective_to > now());
