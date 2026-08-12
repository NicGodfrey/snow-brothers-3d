-- SRM core: supplier contracts, contracted pricing and service levels.

CREATE TABLE srm_contracts (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    number                   TEXT        NOT NULL CHECK (number ~ '^CTR-[0-9]{5,}$'),
    supplier_id              TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE RESTRICT,
    supplier_code            TEXT        NOT NULL,
    type                     TEXT        NOT NULL CHECK (type IN (
        'nda', 'msa', 'framework', 'pricing_agreement', 'sow', 'sla', 'quality_agreement')),
    title                    TEXT        NOT NULL,
    status                   TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_signature', 'signed', 'active', 'expired', 'terminated', 'superseded')),
    currency                 CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    effective_from           DATE,
    effective_to             DATE,
    auto_renew               BOOLEAN     NOT NULL DEFAULT FALSE,
    renewal_term_months      SMALLINT    NOT NULL DEFAULT 12
        CHECK (renewal_term_months BETWEEN 1 AND 120),
    notice_days              SMALLINT    NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 0 AND 365),
    payment_terms_code       TEXT        NOT NULL DEFAULT 'NET30',
    incoterm                 TEXT CHECK (incoterm IN (
        'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
    -- Categories this contract provides commercial cover for.
    category_ids             TEXT[]      NOT NULL DEFAULT '{}',
    minimum_commitment_minor BIGINT      CHECK (minimum_commitment_minor >= 0),
    spend_cap_minor          BIGINT      CHECK (spend_cap_minor >= 0),
    revision                 INTEGER     NOT NULL DEFAULT 1 CHECK (revision >= 1),
    parent_contract_id       TEXT        REFERENCES srm_contracts (id) ON DELETE SET NULL,
    superseded_by_id         TEXT        REFERENCES srm_contracts (id) ON DELETE SET NULL,
    owner_user_id            TEXT,
    document_ref             TEXT,
    expiry_warned_at         TIMESTAMPTZ,
    termination_reason       TEXT,
    termination_date         DATE,
    terminated_by            TEXT,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (id <> parent_contract_id AND id <> superseded_by_id),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    -- An executable contract always has a start date and a spend cap that is
    -- not below its own minimum commitment.
    CHECK (status IN ('draft') OR effective_from IS NOT NULL),
    CHECK (spend_cap_minor IS NULL OR minimum_commitment_minor IS NULL
        OR spend_cap_minor >= minimum_commitment_minor),
    CHECK (status <> 'terminated' OR (termination_reason IS NOT NULL AND termination_date IS NOT NULL)),
    CHECK (status <> 'superseded' OR superseded_by_id IS NOT NULL)
);
CREATE INDEX srm_contracts_supplier_idx ON srm_contracts (tenant_id, supplier_id, status);
-- Drives the nightly term sweep and the expiring-soon queue.
CREATE INDEX srm_contracts_term_idx
    ON srm_contracts (tenant_id, effective_to)
    WHERE status = 'active';

CREATE TABLE srm_contract_sequences (
    tenant_id  TEXT   PRIMARY KEY,
    next_value BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE srm_contract_signatories (
    id           TEXT        PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    contract_id  TEXT        NOT NULL REFERENCES srm_contracts (id) ON DELETE CASCADE,
    party        TEXT        NOT NULL CHECK (party IN ('buyer', 'supplier')),
    name         TEXT        NOT NULL,
    title        TEXT,
    email        TEXT,
    signed_at    TIMESTAMPTZ,
    signed_on    DATE,
    CHECK ((signed_at IS NULL) = (signed_on IS NULL))
);
CREATE INDEX srm_contract_signatories_contract_idx ON srm_contract_signatories (contract_id, party);

-- Tiered contracted pricing. A quantity break is a separate line with its own
-- min_quantity; overlapping validity for the same item and break is rejected
-- by the aggregate.
CREATE TABLE srm_contract_price_lines (
    id               TEXT        PRIMARY KEY,
    tenant_id        TEXT        NOT NULL,
    contract_id      TEXT        NOT NULL REFERENCES srm_contracts (id) ON DELETE CASCADE,
    item_code        TEXT,
    category_id      TEXT        REFERENCES srm_categories (id) ON DELETE SET NULL,
    description      TEXT        NOT NULL,
    uom              TEXT        NOT NULL,
    unit_price_minor BIGINT      NOT NULL CHECK (unit_price_minor >= 0),
    currency         CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    min_quantity     NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
    lead_time_days   SMALLINT    CHECK (lead_time_days BETWEEN 0 AND 365),
    valid_from       DATE        NOT NULL,
    valid_to         DATE,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    -- A line must be addressable by item or by category.
    CHECK (item_code IS NOT NULL OR category_id IS NOT NULL)
);
CREATE INDEX srm_contract_price_lines_lookup_idx
    ON srm_contract_price_lines (tenant_id, item_code, valid_from, min_quantity);

CREATE TABLE srm_contract_commitments (
    id                  TEXT         PRIMARY KEY,
    tenant_id           TEXT         NOT NULL,
    contract_id         TEXT         NOT NULL REFERENCES srm_contracts (id) ON DELETE CASCADE,
    metric              TEXT         NOT NULL CHECK (metric IN (
        'on_time_delivery', 'fill_rate', 'quality_ppm', 'first_pass_yield',
        'response_time_hours', 'resolution_time_hours', 'uptime_percent', 'lead_time_days')),
    description         TEXT,
    target              NUMERIC(14,4) NOT NULL,
    unit                TEXT         NOT NULL,
    direction           TEXT         NOT NULL CHECK (direction IN ('higher_better', 'lower_better')),
    -- Deviation from target tolerated before a breach is recorded.
    tolerance           NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (tolerance >= 0),
    window              TEXT         NOT NULL DEFAULT 'monthly'
        CHECK (window IN ('monthly', 'quarterly', 'annual')),
    -- Breaches forgiven per rolling 12 months before credits start.
    grace_breaches      SMALLINT     NOT NULL DEFAULT 0 CHECK (grace_breaches BETWEEN 0 AND 12),
    penalty_kind        TEXT         NOT NULL DEFAULT 'none'
        CHECK (penalty_kind IN ('none', 'service_credit_percent', 'fixed_credit')),
    penalty_percent     NUMERIC(5,2) CHECK (penalty_percent > 0 AND penalty_percent <= 100),
    penalty_amount_minor BIGINT      CHECK (penalty_amount_minor > 0),
    penalty_currency    CHAR(3),
    -- Hard cap on credits per period, as a percentage of period spend.
    credit_cap_percent  NUMERIC(5,2) NOT NULL DEFAULT 100
        CHECK (credit_cap_percent >= 0 AND credit_cap_percent <= 100),
    effective_from      DATE         NOT NULL,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Consecutive breaches since the last compliant period, for escalation.
    breach_streak       SMALLINT     NOT NULL DEFAULT 0 CHECK (breach_streak >= 0),
    CHECK (penalty_kind <> 'service_credit_percent' OR penalty_percent IS NOT NULL),
    CHECK (penalty_kind <> 'fixed_credit'
        OR (penalty_amount_minor IS NOT NULL AND penalty_currency IS NOT NULL))
);
CREATE INDEX srm_contract_commitments_contract_idx ON srm_contract_commitments (contract_id, metric);

CREATE TABLE srm_contract_escalations (
    commitment_id   TEXT     NOT NULL REFERENCES srm_contract_commitments (id) ON DELETE CASCADE,
    tenant_id       TEXT     NOT NULL,
    after_breaches  SMALLINT NOT NULL CHECK (after_breaches >= 1),
    action          TEXT     NOT NULL,
    PRIMARY KEY (commitment_id, after_breaches)
);

CREATE TABLE srm_contract_breaches (
    id             TEXT          PRIMARY KEY,
    tenant_id      TEXT          NOT NULL,
    contract_id    TEXT          NOT NULL REFERENCES srm_contracts (id) ON DELETE CASCADE,
    commitment_id  TEXT          NOT NULL REFERENCES srm_contract_commitments (id) ON DELETE CASCADE,
    metric         TEXT          NOT NULL,
    period_code    TEXT          NOT NULL,
    target         NUMERIC(14,4) NOT NULL,
    measured       NUMERIC(14,4) NOT NULL,
    deviation      NUMERIC(14,4) NOT NULL CHECK (deviation > 0),
    severity       TEXT          NOT NULL CHECK (severity IN ('minor', 'major', 'severe')),
    status         TEXT          NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'credited', 'waived', 'disputed')),
    credit_minor   BIGINT        CHECK (credit_minor >= 0),
    credit_currency CHAR(3),
    consecutive    SMALLINT      NOT NULL DEFAULT 1 CHECK (consecutive >= 1),
    escalation     TEXT,
    note           TEXT,
    waived_reason  TEXT,
    recorded_on    DATE          NOT NULL,
    credited_on    DATE,
    -- One result per commitment per period; re-publishing cannot double-charge.
    UNIQUE (commitment_id, period_code),
    CHECK (status <> 'credited' OR (credit_minor IS NOT NULL AND credited_on IS NOT NULL)),
    CHECK (status <> 'waived' OR waived_reason IS NOT NULL)
);
CREATE INDEX srm_contract_breaches_open_idx
    ON srm_contract_breaches (tenant_id, contract_id)
    WHERE status IN ('open', 'acknowledged');

CREATE TABLE srm_contract_amendments (
    id           TEXT        PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    contract_id  TEXT        NOT NULL REFERENCES srm_contracts (id) ON DELETE CASCADE,
    revision     INTEGER     NOT NULL CHECK (revision >= 2),
    change_note  TEXT        NOT NULL,
    -- The patch as applied, for a diffable change history.
    changes      JSONB       NOT NULL DEFAULT '{}'::JSONB,
    amended_by   TEXT        NOT NULL,
    amended_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (contract_id, revision)
);

CREATE TABLE srm_contract_renewals (
    contract_id     TEXT        NOT NULL REFERENCES srm_contracts (id) ON DELETE CASCADE,
    tenant_id       TEXT        NOT NULL,
    sequence        SMALLINT    NOT NULL,
    automatic       BOOLEAN     NOT NULL,
    term_months     SMALLINT    NOT NULL CHECK (term_months BETWEEN 1 AND 120),
    previous_end    DATE,
    new_end         DATE        NOT NULL,
    renewed_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (contract_id, sequence),
    CHECK (previous_end IS NULL OR new_end > previous_end)
);
