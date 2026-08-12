-- Rate cards: zone rules, weight breaks, and accessorial fees per
-- (carrier, service level). Money is stored as integer minor units.

CREATE TABLE rate_cards (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    carrier_id          TEXT NOT NULL REFERENCES carriers (id),
    service_level_code  TEXT NOT NULL,
    currency            CHAR(3) NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    dim_factor          NUMERIC(10, 2) NOT NULL DEFAULT 5000 CHECK (dim_factor > 0),
    fuel_surcharge_pct  NUMERIC(5, 2) NOT NULL DEFAULT 0
                        CHECK (fuel_surcharge_pct BETWEEN 0 AND 100),
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_rate_cards_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_rate_cards_lookup
    ON rate_cards (tenant_id, carrier_id, service_level_code, status, effective_from);

CREATE TABLE rate_card_zones (
    rate_card_id    TEXT NOT NULL REFERENCES rate_cards (id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,
    zone            TEXT NOT NULL,
    country         CHAR(2) NOT NULL,
    postal_prefix   TEXT,
    -- '' sentinel keeps (country, prefix) unique even when prefix is NULL
    postal_prefix_key TEXT GENERATED ALWAYS AS (COALESCE(postal_prefix, '')) STORED,
    PRIMARY KEY (rate_card_id, country, postal_prefix_key)
);

CREATE TABLE rate_card_breaks (
    rate_card_id    TEXT NOT NULL REFERENCES rate_cards (id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,
    zone            TEXT NOT NULL,
    max_weight_kg   NUMERIC(10, 2) NOT NULL CHECK (max_weight_kg > 0),
    amount_minor    BIGINT NOT NULL CHECK (amount_minor >= 0),
    PRIMARY KEY (rate_card_id, zone, max_weight_kg)
);

CREATE TABLE rate_card_accessorials (
    rate_card_id    TEXT NOT NULL REFERENCES rate_cards (id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    amount_minor    BIGINT NOT NULL CHECK (amount_minor >= 0),
    PRIMARY KEY (rate_card_id, code)
);
