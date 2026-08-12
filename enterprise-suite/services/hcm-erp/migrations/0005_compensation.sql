-- 0005: Compensation — records, salary revision history, allowances, bonuses.
-- NOTE: payslip deductions are computed by a STUB calculator in the service
-- layer and are intentionally not persisted; a real payroll engine will own
-- payslip storage later.

CREATE TABLE compensation_records (
    id                 TEXT        NOT NULL,
    tenant_id          TEXT        NOT NULL,
    employee_id        TEXT        NOT NULL,
    -- Annual base salary in integer minor units + ISO currency.
    base_salary_minor  BIGINT      NOT NULL CHECK (base_salary_minor > 0),
    currency           CHAR(3)     NOT NULL,
    pay_frequency      TEXT        NOT NULL CHECK (pay_frequency IN ('monthly', 'biweekly', 'weekly')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    version            INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT comp_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT comp_one_per_employee UNIQUE (tenant_id, employee_id)
);

CREATE TABLE salary_revisions (
    id                     TEXT        NOT NULL,
    tenant_id              TEXT        NOT NULL,
    compensation_id        TEXT        NOT NULL,
    revision_number        INTEGER     NOT NULL CHECK (revision_number >= 1),
    previous_salary_minor  BIGINT,
    new_salary_minor       BIGINT      NOT NULL CHECK (new_salary_minor > 0),
    currency               CHAR(3)     NOT NULL,
    effective_date         DATE        NOT NULL,
    reason                 TEXT        NOT NULL CHECK (reason IN (
        'initial', 'merit', 'promotion', 'market_adjustment', 'demotion'
    )),
    changed_by             TEXT        NOT NULL,
    changed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                   TEXT,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT revisions_comp_fk FOREIGN KEY (tenant_id, compensation_id)
        REFERENCES compensation_records (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT revisions_number_unique UNIQUE (tenant_id, compensation_id, revision_number)
);

CREATE INDEX revisions_comp_idx ON salary_revisions (tenant_id, compensation_id, effective_date);

CREATE TABLE allowances (
    tenant_id        TEXT        NOT NULL,
    compensation_id  TEXT        NOT NULL,
    code             TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    amount_minor     BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency         CHAR(3)     NOT NULL,
    recurrence       TEXT        NOT NULL CHECK (recurrence IN ('per_pay_period', 'annual')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, compensation_id, code),
    CONSTRAINT allowances_comp_fk FOREIGN KEY (tenant_id, compensation_id)
        REFERENCES compensation_records (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE bonus_awards (
    id           TEXT        NOT NULL,
    tenant_id    TEXT        NOT NULL,
    employee_id  TEXT        NOT NULL,
    kind         TEXT        NOT NULL CHECK (kind IN ('performance', 'signing', 'retention', 'spot')),
    amount_minor BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency     CHAR(3)     NOT NULL,
    awarded_by   TEXT        NOT NULL,
    payout_date  DATE        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT bonuses_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id)
);

CREATE INDEX bonuses_employee_idx ON bonus_awards (tenant_id, employee_id, payout_date);
CREATE INDEX bonuses_status_idx ON bonus_awards (tenant_id, status);
