-- Shift templates: reusable weekly working-time patterns.

CREATE TABLE mes_shift_template (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX ux_mes_shift_template_tenant_code ON mes_shift_template (tenant_id, code);

CREATE TABLE mes_shift (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    shift_template_id   TEXT NOT NULL REFERENCES mes_shift_template (id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    start_minute_of_day INTEGER NOT NULL CHECK (start_minute_of_day BETWEEN 0 AND 1439),
    duration_minutes    INTEGER NOT NULL CHECK (duration_minutes >= 1),
    break_minutes       INTEGER NOT NULL DEFAULT 0
                        CHECK (break_minutes >= 0 AND break_minutes < duration_minutes),
    -- 0=Sunday .. 6=Saturday, matching Date.getUTCDay()
    days_of_week        SMALLINT[] NOT NULL,
    CONSTRAINT ck_mes_shift_fits_day CHECK (start_minute_of_day + duration_minutes <= 1440)
);

CREATE INDEX ix_mes_shift_template ON mes_shift (tenant_id, shift_template_id);

COMMENT ON TABLE mes_shift IS
    'Shifts must not cross midnight; split into two shifts instead. Overlap on a weekday is rejected in the domain layer.';
