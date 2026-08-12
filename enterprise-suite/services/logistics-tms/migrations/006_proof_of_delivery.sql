-- Proof of delivery: one per shipment, with delivery-time exceptions
-- (OS&D: overages, shortages, damages) as child rows.

CREATE TABLE proof_of_deliveries (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    shipment_id     TEXT NOT NULL REFERENCES shipments (id),
    tracking_number TEXT,
    signed_by       TEXT NOT NULL,
    receiver_role   TEXT NOT NULL DEFAULT 'consignee' CHECK (receiver_role IN (
                        'consignee', 'neighbor', 'front_desk', 'driver_release')),
    method          TEXT NOT NULL CHECK (method IN ('signature', 'photo', 'pin')),
    captured_at     TIMESTAMPTZ NOT NULL,
    document_uri    TEXT,
    notes           TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_pod_shipment UNIQUE (tenant_id, shipment_id)
);

CREATE TABLE pod_exceptions (
    id           BIGSERIAL PRIMARY KEY,
    pod_id       TEXT NOT NULL REFERENCES proof_of_deliveries (id) ON DELETE CASCADE,
    tenant_id    TEXT NOT NULL,
    code         TEXT NOT NULL CHECK (code IN ('damaged', 'shortage', 'refused', 'wet', 'other')),
    description  TEXT NOT NULL,
    package_ref  TEXT,
    noted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pod_exceptions_pod ON pod_exceptions (pod_id);
