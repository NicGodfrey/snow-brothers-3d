-- Working calendars, payment terms and shipping terms.
--
-- Term codes are quoted on orders and invoices, so a code is immutable once
-- issued: changing NET30 to mean 45 days would silently re-date every document
-- that references it. Terms are retired and superseded instead, which is why
-- every table carries validity dates rather than a bare active flag.

CREATE TABLE mdm_calendars (
    tenant_id     TEXT        NOT NULL,
    code          TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
    name          TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    -- 0 = Sunday .. 6 = Saturday. Defaults to the Sat/Sun weekend; Gulf
    -- calendars use {5,6}.
    weekend_days  SMALLINT[]  NOT NULL DEFAULT '{0,6}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, code),
    CHECK (cardinality(weekend_days) < 7),
    CHECK (weekend_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[])
);

CREATE TABLE mdm_calendar_holidays (
    tenant_id      TEXT   NOT NULL,
    calendar_code  TEXT   NOT NULL,
    holiday_date   DATE   NOT NULL,
    description    TEXT,
    PRIMARY KEY (tenant_id, calendar_code, holiday_date),
    FOREIGN KEY (tenant_id, calendar_code) REFERENCES mdm_calendars (tenant_id, code) ON DELETE CASCADE
);

CREATE TABLE mdm_payment_terms (
    tenant_id           TEXT        NOT NULL,
    code                TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
    name                TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    description         TEXT,
    baseline            TEXT        NOT NULL DEFAULT 'invoice_date'
        CHECK (baseline IN ('invoice_date', 'delivery_date', 'goods_receipt_date', 'statement_date')),
    due_kind            TEXT        NOT NULL
        CHECK (due_kind IN ('immediate', 'net_days', 'end_of_month', 'day_of_month', 'proximo')),
    due_days            SMALLINT    CHECK (due_days BETWEEN 0 AND 365),
    due_extra_days      SMALLINT    CHECK (due_extra_days BETWEEN 0 AND 180),
    due_day_of_month    SMALLINT    CHECK (due_day_of_month BETWEEN 1 AND 31),
    due_months_ahead    SMALLINT    CHECK (due_months_ahead BETWEEN 0 AND 12),
    due_cutoff_day      SMALLINT    CHECK (due_cutoff_day BETWEEN 1 AND 31),
    grace_days          SMALLINT    NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 90),
    business_day_rule   TEXT        NOT NULL DEFAULT 'none'
        CHECK (business_day_rule IN ('none', 'next_business_day', 'previous_business_day',
                                     'modified_following')),
    calendar_code       TEXT,
    requires_prepayment BOOLEAN     NOT NULL DEFAULT FALSE,
    active              BOOLEAN     NOT NULL DEFAULT TRUE,
    valid_from          DATE,
    valid_to            DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, code),
    FOREIGN KEY (tenant_id, calendar_code) REFERENCES mdm_calendars (tenant_id, code),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
    -- Each due kind needs exactly the fields it reads and no others.
    CHECK (due_kind <> 'net_days' OR due_days IS NOT NULL),
    CHECK (due_kind <> 'end_of_month' OR due_extra_days IS NOT NULL),
    CHECK (due_kind <> 'day_of_month' OR (due_day_of_month IS NOT NULL AND due_months_ahead IS NOT NULL)),
    CHECK (due_kind <> 'proximo' OR (due_cutoff_day IS NOT NULL AND due_day_of_month IS NOT NULL))
);

-- Early-settlement discounts: "2/10, 1/20, net 30" is two rows. A later window
-- must offer less than an earlier one, which the application enforces across
-- the set.
CREATE TABLE mdm_payment_term_discounts (
    tenant_id     TEXT           NOT NULL,
    term_code     TEXT           NOT NULL,
    days          SMALLINT       NOT NULL CHECK (days >= 0),
    percent       NUMERIC(6, 3)  NOT NULL CHECK (percent > 0 AND percent < 100),
    description   TEXT,
    PRIMARY KEY (tenant_id, term_code, days),
    FOREIGN KEY (tenant_id, term_code) REFERENCES mdm_payment_terms (tenant_id, code) ON DELETE CASCADE
);

CREATE TABLE mdm_payment_term_installments (
    tenant_id     TEXT           NOT NULL,
    term_code     TEXT           NOT NULL,
    sequence      SMALLINT       NOT NULL CHECK (sequence > 0),
    percent       NUMERIC(7, 4)  NOT NULL CHECK (percent > 0 AND percent <= 100),
    days          SMALLINT       NOT NULL CHECK (days >= 0),
    label         TEXT,
    PRIMARY KEY (tenant_id, term_code, sequence),
    FOREIGN KEY (tenant_id, term_code) REFERENCES mdm_payment_terms (tenant_id, code) ON DELETE CASCADE
);

CREATE TABLE mdm_shipping_terms (
    tenant_id                 TEXT        NOT NULL,
    code                      TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
    name                      TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    -- The Incoterms 2020 allocations (clearance, carriage, insurance, risk)
    -- are published rules held in code, not tenant data; a term only names one.
    incoterm                  CHAR(3)     NOT NULL
        CHECK (incoterm IN ('EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
                            'FAS', 'FOB', 'CFR', 'CIF')),
    named_place               TEXT,
    mode                      TEXT        NOT NULL DEFAULT 'road'
        CHECK (mode IN ('road', 'rail', 'sea', 'air', 'inland_waterway', 'multimodal')),
    freight_paid_by           TEXT        NOT NULL
        CHECK (freight_paid_by IN ('seller', 'buyer', 'third_party')),
    freight_billing           TEXT        NOT NULL
        CHECK (freight_billing IN ('prepaid', 'collect', 'prepaid_and_charged')),
    carrier_code              TEXT,
    service_level             TEXT,
    transit_days              SMALLINT    NOT NULL DEFAULT 0 CHECK (transit_days BETWEEN 0 AND 365),
    handling_days             SMALLINT    NOT NULL DEFAULT 0 CHECK (handling_days BETWEEN 0 AND 365),
    calendar_code             TEXT,
    partial_shipments_allowed BOOLEAN     NOT NULL DEFAULT TRUE,
    active                    BOOLEAN     NOT NULL DEFAULT TRUE,
    valid_from                DATE,
    valid_to                  DATE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, code),
    FOREIGN KEY (tenant_id, calendar_code) REFERENCES mdm_calendars (tenant_id, code),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
    -- Every rule but EXW names the place the seller ships to.
    CHECK (incoterm = 'EXW' OR named_place IS NOT NULL),
    -- The four maritime rules are invalid for air or road movements.
    CHECK (incoterm NOT IN ('FAS', 'FOB', 'CFR', 'CIF') OR mode IN ('sea', 'inland_waterway'))
);
CREATE INDEX mdm_shipping_terms_incoterm_idx ON mdm_shipping_terms (tenant_id, incoterm);
