-- quality-qms 0005: supplier quality events + SCAR
--
-- Integration surface towards SRM: srm-core scorecards read these rows
-- (or the corresponding quality.supplier-event.* envelopes) to compute
-- vendor ratings. Demerit points: severity weight x event-type factor,
-- zeroed when an event is written off.

CREATE TABLE quality.supplier_quality_event (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    supplier_id     TEXT        NOT NULL,
    supplier_name   TEXT,
    event_type      TEXT        NOT NULL CHECK (
        event_type IN ('incoming-inspection-failure', 'ncr-issued', 'audit-finding',
                       'certification-lapse', 'delivery-quality', 'field-failure')
    ),
    severity        TEXT        NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
    description     TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'acknowledged', 'in-remediation', 'resolved', 'written-off')
    ),
    demerit_points  INTEGER     NOT NULL CHECK (demerit_points >= 0),
    occurred_at     TIMESTAMPTZ NOT NULL,
    -- linkage back to QMS documents and procurement references
    inspection_lot_id  TEXT REFERENCES quality.inspection_lot (id),
    ncr_id             TEXT REFERENCES quality.ncr (id),
    capa_id            TEXT REFERENCES quality.capa (id),
    audit_id           TEXT,     -- FK added in 0006
    purchase_order_ref TEXT,
    material_code      TEXT,
    -- SCAR (supplier corrective action request)
    scar_number        TEXT,
    scar_issued_at     TIMESTAMPTZ,
    scar_issued_by     TEXT,
    scar_due_at        TIMESTAMPTZ,
    scar_responded_at  TIMESTAMPTZ,
    scar_response_summary  TEXT,
    scar_response_accepted BOOLEAN,
    scar_reviewed_by   TEXT,
    -- resolution / write-off
    resolved_by     TEXT,
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,
    written_off_by  TEXT,
    written_off_at  TIMESTAMPTZ,
    write_off_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    version         INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT scar_number_uq UNIQUE (tenant_id, scar_number),
    CONSTRAINT scar_fields_together CHECK (
        scar_number IS NULL OR (scar_issued_at IS NOT NULL AND scar_due_at IS NOT NULL)
    )
);

CREATE INDEX supplier_event_supplier_ix ON quality.supplier_quality_event (tenant_id, supplier_id);
CREATE INDEX supplier_event_status_ix   ON quality.supplier_quality_event (tenant_id, status);
CREATE INDEX supplier_event_scar_due_ix ON quality.supplier_quality_event (tenant_id, scar_due_at)
    WHERE scar_number IS NOT NULL AND scar_responded_at IS NULL;

COMMENT ON TABLE quality.supplier_quality_event IS
    'Supplier-attributed quality incidents; consumed by srm-core vendor scorecards';
