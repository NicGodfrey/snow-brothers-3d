-- Capacity calendars: shift template + dated exceptions per plant/work center.

CREATE TABLE mes_capacity_calendar (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    code               TEXT NOT NULL,
    name               TEXT NOT NULL,
    shift_template_id  TEXT NOT NULL REFERENCES mes_shift_template (id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    version            INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX ux_mes_capacity_calendar_tenant_code
    ON mes_capacity_calendar (tenant_id, code);

CREATE TABLE mes_calendar_exception (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    calendar_id  TEXT NOT NULL REFERENCES mes_capacity_calendar (id) ON DELETE CASCADE,
    date         DATE NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('HOLIDAY', 'DOWNTIME', 'OVERTIME')),
    -- HOLIDAY zeroes the day; DOWNTIME subtracts minutes; OVERTIME adds them
    minutes      INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
    reason       TEXT,
    CONSTRAINT ck_mes_calendar_exception_minutes
        CHECK (type = 'HOLIDAY' OR minutes > 0)
);

CREATE UNIQUE INDEX ux_mes_calendar_exception_date
    ON mes_calendar_exception (tenant_id, calendar_id, date);

ALTER TABLE mes_work_center
    ADD CONSTRAINT fk_mes_work_center_calendar
    FOREIGN KEY (calendar_id) REFERENCES mes_capacity_calendar (id);
