-- Dock appointments. Overlap prevention for door-holding statuses is
-- enforced with a btree_gist exclusion constraint mirroring
-- DockAppointment.overlaps().

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE dock_appointments (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    reference_code  TEXT NOT NULL,
    facility_code   TEXT NOT NULL,
    dock_door       TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    carrier_id      TEXT REFERENCES carriers (id),
    load_id         TEXT REFERENCES loads (id),
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
                        'requested', 'confirmed', 'checked_in',
                        'completed', 'cancelled', 'no_show')),
    checked_in_at   TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    notes           TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dock_appt_reference UNIQUE (tenant_id, reference_code),
    CONSTRAINT ck_dock_appt_window CHECK (window_end > window_start),
    CONSTRAINT ex_dock_appt_no_overlap EXCLUDE USING gist (
        tenant_id WITH =,
        facility_code WITH =,
        dock_door WITH =,
        tstzrange(window_start, window_end) WITH &&
    ) WHERE (status IN ('requested', 'confirmed', 'checked_in'))
);

CREATE INDEX idx_dock_appt_facility_day
    ON dock_appointments (tenant_id, facility_code, window_start);
CREATE INDEX idx_dock_appt_status ON dock_appointments (tenant_id, status);
