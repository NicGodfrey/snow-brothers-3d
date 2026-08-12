-- 0003: Leave management — policies, holiday calendars, balances, requests.

CREATE TABLE leave_policies (
    id                      TEXT        NOT NULL,
    tenant_id               TEXT        NOT NULL,
    leave_type              TEXT        NOT NULL,
    name                    TEXT        NOT NULL,
    accrual_days_per_year   NUMERIC(5,2) NOT NULL CHECK (accrual_days_per_year >= 0 AND accrual_days_per_year <= 366),
    max_carryover_days      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (max_carryover_days >= 0),
    requires_approval       BOOLEAN     NOT NULL DEFAULT TRUE,
    allow_negative_balance  BOOLEAN     NOT NULL DEFAULT FALSE,
    paid                    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                 INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT leave_policies_type_unique UNIQUE (tenant_id, leave_type)
);

CREATE TABLE holiday_calendars (
    id          TEXT        NOT NULL,
    tenant_id   TEXT        NOT NULL,
    year        INTEGER     NOT NULL CHECK (year BETWEEN 1900 AND 2200),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT holiday_calendars_year_unique UNIQUE (tenant_id, year)
);

CREATE TABLE holidays (
    tenant_id    TEXT NOT NULL,
    calendar_id  TEXT NOT NULL,
    holiday_date DATE NOT NULL,
    name         TEXT NOT NULL,
    PRIMARY KEY (tenant_id, calendar_id, holiday_date),
    CONSTRAINT holidays_calendar_fk FOREIGN KEY (tenant_id, calendar_id)
        REFERENCES holiday_calendars (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE leave_balances (
    id                TEXT        NOT NULL,
    tenant_id         TEXT        NOT NULL,
    employee_id       TEXT        NOT NULL,
    leave_type        TEXT        NOT NULL,
    year              INTEGER     NOT NULL CHECK (year BETWEEN 1900 AND 2200),
    -- Upfront annual grant (pro-rated in the hire year).
    entitled_days     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
    -- Monthly accrual mechanism (alternative to upfront grants).
    accrued_days      NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (accrued_days >= 0),
    carried_over_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carried_over_days >= 0),
    -- Signed manual HR adjustments.
    adjustment_days   NUMERIC(6,2) NOT NULL DEFAULT 0,
    taken_days        NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (taken_days >= 0),
    pending_days      NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (pending_days >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT balances_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT balances_unique UNIQUE (tenant_id, employee_id, leave_type, year)
);

CREATE INDEX balances_employee_idx ON leave_balances (tenant_id, employee_id, year);

CREATE TABLE leave_requests (
    id             TEXT        NOT NULL,
    tenant_id      TEXT        NOT NULL,
    employee_id    TEXT        NOT NULL,
    leave_type     TEXT        NOT NULL,
    start_date     DATE        NOT NULL,
    end_date       DATE        NOT NULL,
    working_days   NUMERIC(5,2) NOT NULL CHECK (working_days > 0),
    reason         TEXT,
    status         TEXT        NOT NULL DEFAULT 'submitted' CHECK (status IN (
        'submitted', 'approved', 'rejected', 'cancelled'
    )),
    decided_by     TEXT,
    decided_at     TIMESTAMPTZ,
    decision_note  TEXT,
    cancelled_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT requests_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT requests_date_range CHECK (end_date >= start_date),
    CONSTRAINT requests_decision_rule CHECK (
        (status IN ('approved', 'rejected') AND decided_by IS NOT NULL)
        OR status IN ('submitted', 'cancelled')
    )
);

CREATE INDEX requests_employee_idx ON leave_requests (tenant_id, employee_id, start_date);
CREATE INDEX requests_status_idx ON leave_requests (tenant_id, status);

-- Overlap guard for non-terminal requests (requires btree_gist in Postgres):
-- ALTER TABLE leave_requests ADD CONSTRAINT requests_no_overlap
--     EXCLUDE USING gist (
--         tenant_id WITH =, employee_id WITH =,
--         daterange(start_date, end_date, '[]') WITH &&
--     ) WHERE (status IN ('submitted', 'approved'));
