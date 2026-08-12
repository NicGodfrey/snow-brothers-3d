-- 0004: Attendance periods and time entries.

CREATE TABLE attendance_periods (
    id            TEXT        NOT NULL,
    tenant_id     TEXT        NOT NULL,
    employee_id   TEXT        NOT NULL,
    year          INTEGER     NOT NULL CHECK (year BETWEEN 1900 AND 2200),
    month         INTEGER     NOT NULL CHECK (month BETWEEN 1 AND 12),
    status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'submitted', 'approved', 'locked'
    )),
    submitted_at  TIMESTAMPTZ,
    approved_by   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT periods_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT periods_unique UNIQUE (tenant_id, employee_id, year, month)
);

CREATE INDEX periods_employee_idx ON attendance_periods (tenant_id, employee_id);
CREATE INDEX periods_status_idx ON attendance_periods (tenant_id, status);

CREATE TABLE attendance_entries (
    id             TEXT        NOT NULL,
    tenant_id      TEXT        NOT NULL,
    period_id      TEXT        NOT NULL,
    entry_date     DATE        NOT NULL,
    kind           TEXT        NOT NULL CHECK (kind IN (
        'work', 'remote', 'training', 'leave', 'sick', 'holiday'
    )),
    start_time     TIME,
    end_time       TIME,
    break_minutes  INTEGER     NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    -- Net hours, 2dp; 0 for day-marker kinds (leave/sick/holiday).
    hours          NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 16),
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT entries_period_fk FOREIGN KEY (tenant_id, period_id)
        REFERENCES attendance_periods (tenant_id, id) ON DELETE CASCADE,
    -- Timed kinds carry times; day markers must not.
    CONSTRAINT entries_times_rule CHECK (
        (kind IN ('work', 'remote', 'training') AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
        OR (kind IN ('leave', 'sick', 'holiday') AND start_time IS NULL AND end_time IS NULL)
    )
);

CREATE INDEX entries_period_idx ON attendance_entries (tenant_id, period_id, entry_date);

-- One day marker per date per period (timed entries may repeat on a date).
CREATE UNIQUE INDEX entries_one_marker_per_day
    ON attendance_entries (tenant_id, period_id, entry_date)
    WHERE kind IN ('leave', 'sick', 'holiday');
