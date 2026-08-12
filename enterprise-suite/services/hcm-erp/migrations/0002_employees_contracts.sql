-- 0002: Employees and employment contracts (with amendment history).

CREATE TABLE employees (
    id                   TEXT        NOT NULL,
    tenant_id            TEXT        NOT NULL,
    employee_number      TEXT        NOT NULL,
    first_name           TEXT        NOT NULL,
    last_name            TEXT        NOT NULL,
    email                TEXT        NOT NULL,
    hire_date            DATE        NOT NULL,
    status               TEXT        NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'on_leave', 'suspended', 'terminated'
    )),
    manager_employee_id  TEXT,
    primary_position_id  TEXT,
    termination_date     DATE,
    termination_reason   TEXT CHECK (termination_reason IN (
        'resignation', 'dismissal', 'redundancy', 'retirement', 'end_of_contract', 'other'
    )),
    rehire_eligible      BOOLEAN,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    version              INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT employees_number_unique UNIQUE (tenant_id, employee_number),
    CONSTRAINT employees_email_unique UNIQUE (tenant_id, email),
    CONSTRAINT employees_manager_fk FOREIGN KEY (tenant_id, manager_employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT employees_position_fk FOREIGN KEY (tenant_id, primary_position_id)
        REFERENCES positions (tenant_id, id),
    CONSTRAINT employees_no_self_manage CHECK (manager_employee_id IS DISTINCT FROM id),
    CONSTRAINT employees_termination_rule CHECK (
        (status = 'terminated' AND termination_date IS NOT NULL AND termination_reason IS NOT NULL)
        OR (status <> 'terminated' AND termination_date IS NULL)
    ),
    CONSTRAINT employees_termination_after_hire CHECK (
        termination_date IS NULL OR termination_date >= hire_date
    )
);

CREATE INDEX employees_manager_idx ON employees (tenant_id, manager_employee_id);
CREATE INDEX employees_status_idx ON employees (tenant_id, status);

CREATE TABLE employment_contracts (
    id                  TEXT        NOT NULL,
    tenant_id           TEXT        NOT NULL,
    employee_id         TEXT        NOT NULL,
    position_id         TEXT        NOT NULL,
    contract_type       TEXT        NOT NULL CHECK (contract_type IN (
        'permanent', 'fixed_term', 'contractor', 'intern'
    )),
    start_date          DATE        NOT NULL,
    end_date            DATE,
    probation_end_date  DATE,
    fte                 NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (fte > 0 AND fte <= 1),
    weekly_hours        NUMERIC(4,1) NOT NULL CHECK (weekly_hours > 0 AND weekly_hours <= 60),
    -- Annual base salary in integer minor units + ISO currency.
    base_salary_minor   BIGINT      NOT NULL CHECK (base_salary_minor > 0),
    currency            CHAR(3)     NOT NULL,
    pay_frequency       TEXT        NOT NULL DEFAULT 'monthly' CHECK (pay_frequency IN (
        'monthly', 'biweekly', 'weekly'
    )),
    status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'active', 'terminated', 'expired'
    )),
    terminated_date     DATE,
    termination_note    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    version             INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT contracts_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT contracts_position_fk FOREIGN KEY (tenant_id, position_id)
        REFERENCES positions (tenant_id, id),
    CONSTRAINT contracts_dates CHECK (end_date IS NULL OR end_date > start_date),
    CONSTRAINT contracts_probation CHECK (probation_end_date IS NULL OR probation_end_date > start_date),
    CONSTRAINT contracts_fixed_term_end CHECK (
        contract_type NOT IN ('fixed_term', 'intern') OR end_date IS NOT NULL
    ),
    CONSTRAINT contracts_permanent_no_end CHECK (
        contract_type <> 'permanent' OR end_date IS NULL
    )
);

-- At most one active contract per employee.
CREATE UNIQUE INDEX contracts_one_active_per_employee
    ON employment_contracts (tenant_id, employee_id)
    WHERE status = 'active';
CREATE INDEX contracts_employee_idx ON employment_contracts (tenant_id, employee_id);
CREATE INDEX contracts_status_idx ON employment_contracts (tenant_id, status);

CREATE TABLE contract_amendments (
    id                 TEXT        NOT NULL,
    tenant_id          TEXT        NOT NULL,
    contract_id        TEXT        NOT NULL,
    amendment_number   INTEGER     NOT NULL CHECK (amendment_number >= 1),
    effective_date     DATE        NOT NULL,
    amended_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    amended_by         TEXT        NOT NULL,
    -- Whitelisted term deltas captured as JSON: fte, weekly_hours, end_date, base_salary.
    changes            JSONB       NOT NULL,
    note               TEXT,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT amendments_contract_fk FOREIGN KEY (tenant_id, contract_id)
        REFERENCES employment_contracts (tenant_id, id),
    CONSTRAINT amendments_number_unique UNIQUE (tenant_id, contract_id, amendment_number)
);

CREATE INDEX amendments_contract_idx ON contract_amendments (tenant_id, contract_id);
