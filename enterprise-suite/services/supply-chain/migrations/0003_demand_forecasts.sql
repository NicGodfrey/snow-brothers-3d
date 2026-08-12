-- Weekly demand forecasts, one editable DRAFT series at a time; publishing
-- archives the previously published series for the same (sku, location).

CREATE TABLE demand_forecast (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    sku          TEXT        NOT NULL,
    location     TEXT        NOT NULL,
    source       TEXT        NOT NULL DEFAULT 'STATISTICAL'
        CHECK (source IN ('STATISTICAL', 'SALES_INPUT', 'OVERRIDE')),
    status       TEXT        NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    notes        TEXT,
    published_at TIMESTAMPTZ,
    version      INTEGER     NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MRP reads exactly one published series per item/location.
CREATE UNIQUE INDEX ux_forecast_published
    ON demand_forecast (tenant_id, sku, location)
    WHERE status = 'PUBLISHED';
CREATE INDEX ix_forecast_item ON demand_forecast (tenant_id, sku, location, status);

CREATE TABLE demand_forecast_entry (
    forecast_id TEXT           NOT NULL REFERENCES demand_forecast (id) ON DELETE CASCADE,
    week_start  DATE           NOT NULL, -- always a Monday
    qty         NUMERIC(14, 3) NOT NULL CHECK (qty >= 0),
    PRIMARY KEY (forecast_id, week_start)
);
