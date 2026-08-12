-- Carriers and their service levels.
-- All tables are tenant-partitioned; every unique constraint includes tenant_id.

CREATE TABLE carriers (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    mode            TEXT NOT NULL CHECK (mode IN ('parcel', 'ltl', 'ftl')),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    scac            TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_carriers_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_carriers_tenant_status ON carriers (tenant_id, status);
CREATE INDEX idx_carriers_tenant_mode ON carriers (tenant_id, mode);

CREATE TABLE carrier_service_levels (
    carrier_id          TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
    tenant_id           TEXT NOT NULL,
    code                TEXT NOT NULL,
    name                TEXT NOT NULL,
    transit_days        INTEGER NOT NULL CHECK (transit_days BETWEEN 0 AND 60),
    cutoff_hour         INTEGER NOT NULL CHECK (cutoff_hour BETWEEN 0 AND 23),
    signature_required  BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (carrier_id, code)
);

CREATE INDEX idx_service_levels_tenant ON carrier_service_levels (tenant_id);
