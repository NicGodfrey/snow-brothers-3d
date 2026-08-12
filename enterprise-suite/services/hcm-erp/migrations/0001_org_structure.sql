-- 0001: Organizational structure — org units and positions.
-- All HCM tables are tenant-partitioned; every FK is scoped by (tenant_id, id)
-- so rows can never reference another tenant's data.

CREATE TABLE org_units (
    id                   TEXT        NOT NULL,
    tenant_id            TEXT        NOT NULL,
    code                 TEXT        NOT NULL,
    name                 TEXT        NOT NULL,
    kind                 TEXT        NOT NULL CHECK (kind IN ('company', 'division', 'department', 'team')),
    parent_id            TEXT,
    cost_center          TEXT,
    manager_position_id  TEXT,
    status               TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    version              INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT org_units_code_unique UNIQUE (tenant_id, code),
    CONSTRAINT org_units_parent_fk FOREIGN KEY (tenant_id, parent_id)
        REFERENCES org_units (tenant_id, id),
    -- Company units are roots; everything else needs a parent.
    CONSTRAINT org_units_root_rule CHECK (
        (kind = 'company' AND parent_id IS NULL) OR (kind <> 'company' AND parent_id IS NOT NULL)
    )
);

CREATE INDEX org_units_parent_idx ON org_units (tenant_id, parent_id);
CREATE INDEX org_units_status_idx ON org_units (tenant_id, status);

CREATE TABLE positions (
    id                       TEXT        NOT NULL,
    tenant_id                TEXT        NOT NULL,
    org_unit_id              TEXT        NOT NULL,
    title                    TEXT        NOT NULL,
    job_family               TEXT        NOT NULL DEFAULT 'general',
    grade                    TEXT        NOT NULL CHECK (grade IN (
        'IC1','IC2','IC3','IC4','IC5','IC6','IC7','M1','M2','M3','M4','M5'
    )),
    fte                      NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (fte > 0 AND fte <= 1),
    reports_to_position_id   TEXT,
    status                   TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'filled', 'frozen', 'eliminated'
    )),
    current_employee_id      TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                  INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT positions_org_unit_fk FOREIGN KEY (tenant_id, org_unit_id)
        REFERENCES org_units (tenant_id, id),
    CONSTRAINT positions_reports_to_fk FOREIGN KEY (tenant_id, reports_to_position_id)
        REFERENCES positions (tenant_id, id),
    CONSTRAINT positions_no_self_report CHECK (reports_to_position_id IS DISTINCT FROM id),
    -- A position is filled if and only if it points at an employee.
    CONSTRAINT positions_filled_rule CHECK (
        (status = 'filled' AND current_employee_id IS NOT NULL)
        OR (status <> 'filled' AND current_employee_id IS NULL)
    )
);

CREATE INDEX positions_org_unit_idx ON positions (tenant_id, org_unit_id);
CREATE INDEX positions_status_idx ON positions (tenant_id, status);
CREATE INDEX positions_employee_idx ON positions (tenant_id, current_employee_id)
    WHERE current_employee_id IS NOT NULL;
