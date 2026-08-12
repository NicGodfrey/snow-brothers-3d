-- Tenant currency configuration and effective-dated FX rates.
--
-- ISO 4217 itself is code-side reference data (minor units, cash increments)
-- rather than a table: it changes by standards revision, not by deployment.
-- What is stored is which currencies a tenant transacts in and the rates it
-- has been quoted.

CREATE TABLE mdm_tenant_currencies (
    tenant_id       TEXT        NOT NULL,
    code            CHAR(3)     NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
    enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
    is_functional   BOOLEAN     NOT NULL DEFAULT FALSE,
    rounding_mode   TEXT        NOT NULL DEFAULT 'half-up'
        CHECK (rounding_mode IN ('half-up', 'half-even', 'half-down', 'ceil', 'floor', 'trunc')),
    display_symbol  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, code),
    -- The books are kept in exactly one currency, and it must be transactable.
    CHECK (NOT is_functional OR enabled)
);
CREATE UNIQUE INDEX mdm_tenant_currencies_functional_uq
    ON mdm_tenant_currencies (tenant_id)
    WHERE is_functional;

-- Rates are append-only in normal operation: a later quote is a new row, not
-- an edit. `unit` carries the quotation convention (JPY quoted per 100), so
-- the effective multiplier is rate / unit.
CREATE TABLE mdm_fx_rates (
    id            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    base          CHAR(3)     NOT NULL,
    quote         CHAR(3)     NOT NULL,
    rate          NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
    unit          INTEGER     NOT NULL DEFAULT 1 CHECK (unit > 0),
    rate_type     TEXT        NOT NULL DEFAULT 'spot'
        CHECK (rate_type IN ('spot', 'daily', 'monthly-average', 'budget', 'hedge', 'statutory')),
    valid_from    TIMESTAMPTZ NOT NULL,
    valid_to      TIMESTAMPTZ,
    source        TEXT        NOT NULL DEFAULT 'manual',
    created_at    TIMESTAMPTZ NOT NULL,

    CHECK (base <> quote),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    -- One quote per pair, type and start date; corrections update in place and
    -- emit an FxRateCorrected event carrying the previous number.
    UNIQUE (tenant_id, base, quote, rate_type, valid_from),
    FOREIGN KEY (tenant_id, base) REFERENCES mdm_tenant_currencies (tenant_id, code),
    FOREIGN KEY (tenant_id, quote) REFERENCES mdm_tenant_currencies (tenant_id, code)
);
-- Resolution reads the newest effective row for a pair, so order the index the
-- way the lookup scans it.
CREATE INDEX mdm_fx_rates_lookup_idx
    ON mdm_fx_rates (tenant_id, base, quote, rate_type, valid_from DESC);
CREATE INDEX mdm_fx_rates_asof_idx ON mdm_fx_rates (tenant_id, valid_from DESC);

-- Audit trail for corrections, which are the only mutation a rate ever sees.
CREATE TABLE mdm_fx_rate_corrections (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    fx_rate_id     TEXT        NOT NULL REFERENCES mdm_fx_rates (id) ON DELETE CASCADE,
    previous_rate  NUMERIC(20, 10) NOT NULL CHECK (previous_rate > 0),
    new_rate       NUMERIC(20, 10) NOT NULL CHECK (new_rate > 0),
    reason         TEXT        NOT NULL CHECK (length(btrim(reason)) > 0),
    corrected_by   TEXT        NOT NULL,
    corrected_at   TIMESTAMPTZ NOT NULL,
    CHECK (previous_rate <> new_rate)
);
CREATE INDEX mdm_fx_rate_corrections_rate_idx ON mdm_fx_rate_corrections (fx_rate_id, corrected_at DESC);
