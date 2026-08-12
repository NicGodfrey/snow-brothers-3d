-- Shipments, their packages, and tracking-event history.
-- Addresses are embedded (a shipment is a document, not a join graph).

CREATE TABLE shipments (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    reference             TEXT NOT NULL,
    order_ref             TEXT,
    status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                              'draft', 'booked', 'picked_up', 'in_transit',
                              'out_for_delivery', 'delivered', 'exception', 'cancelled')),
    progress_rank         INTEGER NOT NULL DEFAULT 0,

    origin_name           TEXT NOT NULL,
    origin_line1          TEXT NOT NULL,
    origin_line2          TEXT,
    origin_city           TEXT NOT NULL,
    origin_region         TEXT,
    origin_postal_code    TEXT NOT NULL,
    origin_country        CHAR(2) NOT NULL,

    dest_name             TEXT NOT NULL,
    dest_line1            TEXT NOT NULL,
    dest_line2            TEXT,
    dest_city             TEXT NOT NULL,
    dest_region           TEXT,
    dest_postal_code      TEXT NOT NULL,
    dest_country          CHAR(2) NOT NULL,

    carrier_id            TEXT REFERENCES carriers (id),
    carrier_code          TEXT,
    service_level_code    TEXT,
    tracking_number       TEXT,

    -- cost breakdown captured at booking (minor units)
    cost_rate_card_id     TEXT,
    cost_currency         CHAR(3),
    cost_zone             TEXT,
    cost_billable_weight_kg NUMERIC(10, 2),
    cost_base_minor       BIGINT,
    cost_fuel_minor       BIGINT,
    cost_accessorials_minor BIGINT,
    cost_total_minor      BIGINT,

    requested_accessorials TEXT[] NOT NULL DEFAULT '{}',
    pod_id                TEXT,
    cancel_reason         TEXT,
    version               INTEGER NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shipments_tenant_reference UNIQUE (tenant_id, reference)
);

CREATE UNIQUE INDEX uq_shipments_tenant_tracking
    ON shipments (tenant_id, tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX idx_shipments_tenant_status ON shipments (tenant_id, status);
CREATE INDEX idx_shipments_tenant_order_ref
    ON shipments (tenant_id, order_ref) WHERE order_ref IS NOT NULL;

CREATE TABLE shipment_packages (
    id                    TEXT PRIMARY KEY,
    shipment_id           TEXT NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
    tenant_id             TEXT NOT NULL,
    reference             TEXT NOT NULL,
    weight_kg             NUMERIC(10, 3) NOT NULL CHECK (weight_kg > 0),
    length_cm             NUMERIC(10, 2) NOT NULL CHECK (length_cm > 0),
    width_cm              NUMERIC(10, 2) NOT NULL CHECK (width_cm > 0),
    height_cm             NUMERIC(10, 2) NOT NULL CHECK (height_cm > 0),
    declared_value_minor  BIGINT CHECK (declared_value_minor >= 0)
);

CREATE INDEX idx_packages_shipment ON shipment_packages (shipment_id);

CREATE TABLE shipment_tracking_events (
    id            TEXT PRIMARY KEY,
    shipment_id   TEXT NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
    tenant_id     TEXT NOT NULL,
    code          TEXT NOT NULL CHECK (code IN ('PU', 'DP', 'AR', 'OD', 'DL', 'EX', 'NT')),
    description   TEXT NOT NULL,
    location      TEXT,
    occurred_at   TIMESTAMPTZ NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracking_events_shipment ON shipment_tracking_events (shipment_id, occurred_at);
