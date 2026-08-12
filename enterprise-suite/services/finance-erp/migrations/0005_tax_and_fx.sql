-- Tax codes: rate reference data applied on AR/AP document lines.
CREATE TABLE fin_tax_code (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    rate_bps    INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
    scope       TEXT NOT NULL DEFAULT 'BOTH' CHECK (scope IN ('SALES', 'PURCHASE', 'BOTH')),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_fin_tax_code_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_fin_tax_code_tenant ON fin_tax_code (tenant_id);

-- FX rates: stored reference data only; journals remain single-currency.
-- rate_micros is scaled by 1e6 (1_084_500 = 1.0845 quote per base unit).
CREATE TABLE fin_fx_rate (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    base_currency   CHAR(3) NOT NULL,
    quote_currency  CHAR(3) NOT NULL,
    rate_micros     BIGINT NOT NULL CHECK (rate_micros > 0),
    as_of_date      DATE NOT NULL,
    source          TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'ECB', 'FED', 'PROVIDER')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_fin_fx_rate_pair CHECK (base_currency <> quote_currency)
);

CREATE INDEX idx_fin_fx_rate_lookup
    ON fin_fx_rate (tenant_id, base_currency, quote_currency, as_of_date DESC);
