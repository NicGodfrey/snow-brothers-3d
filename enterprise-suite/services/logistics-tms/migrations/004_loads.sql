-- Loads (truck movements), their ordered stops, and shipment assignments.

CREATE TABLE loads (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    reference           TEXT NOT NULL,
    mode                TEXT NOT NULL CHECK (mode IN ('ltl', 'ftl')),
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                            'planned', 'dispatched', 'in_transit', 'completed', 'cancelled')),
    carrier_id          TEXT REFERENCES carriers (id),
    driver_name         TEXT,
    vehicle_ref         TEXT,
    planned_distance_km NUMERIC(10, 1) CHECK (planned_distance_km > 0),
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_loads_tenant_reference UNIQUE (tenant_id, reference)
);

CREATE INDEX idx_loads_tenant_status ON loads (tenant_id, status);

CREATE TABLE load_stops (
    id             TEXT PRIMARY KEY,
    load_id        TEXT NOT NULL REFERENCES loads (id) ON DELETE CASCADE,
    tenant_id      TEXT NOT NULL,
    sequence       INTEGER NOT NULL CHECK (sequence >= 1),
    stop_type      TEXT NOT NULL CHECK (stop_type IN ('pickup', 'delivery')),
    facility_name  TEXT NOT NULL,
    addr_name      TEXT NOT NULL,
    addr_line1     TEXT NOT NULL,
    addr_line2     TEXT,
    addr_city      TEXT NOT NULL,
    addr_region    TEXT,
    addr_postal    TEXT NOT NULL,
    addr_country   CHAR(2) NOT NULL,
    window_start   TIMESTAMPTZ,
    window_end     TIMESTAMPTZ,
    arrived_at     TIMESTAMPTZ,
    departed_at    TIMESTAMPTZ,
    CONSTRAINT uq_load_stops_sequence UNIQUE (load_id, sequence),
    CONSTRAINT ck_load_stops_window
        CHECK (window_start IS NULL OR window_end IS NULL OR window_end > window_start),
    CONSTRAINT ck_load_stops_visit
        CHECK (departed_at IS NULL OR arrived_at IS NOT NULL)
);

CREATE INDEX idx_load_stops_load ON load_stops (load_id, sequence);

CREATE TABLE load_shipments (
    load_id           TEXT NOT NULL REFERENCES loads (id) ON DELETE CASCADE,
    tenant_id         TEXT NOT NULL,
    shipment_id       TEXT NOT NULL REFERENCES shipments (id),
    pickup_stop_id    TEXT NOT NULL REFERENCES load_stops (id),
    delivery_stop_id  TEXT NOT NULL REFERENCES load_stops (id),
    PRIMARY KEY (load_id, shipment_id)
);

CREATE INDEX idx_load_shipments_shipment ON load_shipments (shipment_id);
