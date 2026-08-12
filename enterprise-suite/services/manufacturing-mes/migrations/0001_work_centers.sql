-- Work centers: physical or logical production resources.
-- Rates are integer minor units (see shared-kernel Money).

CREATE TABLE mes_work_center (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL,
    code                     TEXT NOT NULL,
    name                     TEXT NOT NULL,
    description              TEXT,
    cost_center_code         TEXT,
    status                   TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE')),
    machine_count            INTEGER NOT NULL DEFAULT 1 CHECK (machine_count >= 1),
    efficiency_pct           NUMERIC(5, 2) NOT NULL DEFAULT 85.00
                             CHECK (efficiency_pct > 0 AND efficiency_pct <= 100),
    utilization_pct          NUMERIC(5, 2) NOT NULL DEFAULT 90.00
                             CHECK (utilization_pct > 0 AND utilization_pct <= 100),
    default_queue_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (default_queue_minutes >= 0),
    currency                 CHAR(3) NOT NULL DEFAULT 'USD',
    labor_rate_minor         BIGINT NOT NULL DEFAULT 0,
    machine_rate_minor       BIGINT NOT NULL DEFAULT 0,
    overhead_rate_minor      BIGINT NOT NULL DEFAULT 0,
    calendar_id              TEXT,
    tags                     TEXT[] NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                  INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX ux_mes_work_center_tenant_code ON mes_work_center (tenant_id, code);
CREATE INDEX ix_mes_work_center_tenant_status ON mes_work_center (tenant_id, status);

COMMENT ON TABLE mes_work_center IS
    'Production resources (machines, cells, lines) with cost rates and capacity factors';
COMMENT ON COLUMN mes_work_center.efficiency_pct IS
    'Realistic output vs theoretical; multiplied into effective capacity';
