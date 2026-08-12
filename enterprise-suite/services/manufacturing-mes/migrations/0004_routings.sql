-- Routings: the manufacturing process definition per SKU/revision.

CREATE TABLE mes_routing (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    sku          TEXT NOT NULL,
    revision     TEXT NOT NULL DEFAULT 'A',
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'RELEASED', 'OBSOLETE')),
    released_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX ux_mes_routing_sku_revision ON mes_routing (tenant_id, sku, revision);
CREATE INDEX ix_mes_routing_sku_status ON mes_routing (tenant_id, sku, status);

CREATE TABLE mes_routing_operation (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    routing_id           TEXT NOT NULL REFERENCES mes_routing (id) ON DELETE CASCADE,
    seq                  INTEGER NOT NULL CHECK (seq >= 1),
    description          TEXT NOT NULL,
    work_center_id       TEXT NOT NULL REFERENCES mes_work_center (id),
    setup_minutes        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
    run_minutes_per_unit NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (run_minutes_per_unit >= 0),
    teardown_minutes     NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (teardown_minutes >= 0),
    queue_minutes        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (queue_minutes >= 0),
    move_minutes         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (move_minutes >= 0),
    inspection_required  BOOLEAN NOT NULL DEFAULT FALSE,
    crew_size            INTEGER NOT NULL DEFAULT 1 CHECK (crew_size >= 0),
    CONSTRAINT ck_mes_routing_op_has_time
        CHECK (setup_minutes + run_minutes_per_unit + teardown_minutes > 0)
);

CREATE UNIQUE INDEX ux_mes_routing_operation_seq
    ON mes_routing_operation (tenant_id, routing_id, seq);
CREATE INDEX ix_mes_routing_operation_work_center
    ON mes_routing_operation (tenant_id, work_center_id);
