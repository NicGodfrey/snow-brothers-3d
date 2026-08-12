-- PRM core: partner contracts.
--
--   draft → pending_signature → active → expired | terminated
--     \→ cancelled
--
-- Both parties must sign before activation, and a partner may hold only one
-- active trading contract (reseller / distribution / msp / referral) at a time
-- — that one is enforced by a partial unique index rather than by the service
-- alone, because it is the rule that decides which discount applies to an
-- order.

CREATE TABLE prmc_contracts (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    number                   TEXT        NOT NULL CHECK (number ~ '^PCT-[0-9]{5,}$'),
    partner_id               TEXT        NOT NULL REFERENCES prmc_partners (id) ON DELETE RESTRICT,
    type                     TEXT        NOT NULL CHECK (type IN (
        'reseller', 'distribution', 'referral', 'msp', 'nda', 'mdf_terms')),
    status                   TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_signature', 'active', 'expired', 'terminated', 'cancelled')),
    title                    TEXT        NOT NULL CHECK (length(title) >= 1),
    currency                 CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    effective_from           TIMESTAMPTZ NOT NULL,
    effective_to             TIMESTAMPTZ NOT NULL,
    auto_renew               BOOLEAN     NOT NULL DEFAULT FALSE,
    renewal_term_months      INTEGER     NOT NULL DEFAULT 12 CHECK (renewal_term_months BETWEEN 0 AND 120),
    notice_days              INTEGER     NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 0 AND 365),
    payment_terms_days       INTEGER     NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    base_discount_bps        INTEGER     NOT NULL DEFAULT 0 CHECK (base_discount_bps BETWEEN 0 AND 10000),
    mdf_eligible             BOOLEAN     NOT NULL DEFAULT FALSE,
    mdf_accrual_bps          INTEGER     NOT NULL DEFAULT 0 CHECK (mdf_accrual_bps BETWEEN 0 AND 10000),
    revenue_commitment_minor BIGINT      CHECK (revenue_commitment_minor IS NULL OR revenue_commitment_minor >= 0),
    governing_law            TEXT,
    renewal_count            INTEGER     NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
    sent_for_signature_at    TIMESTAMPTZ,
    activated_at             TIMESTAMPTZ,
    expired_at               TIMESTAMPTZ,
    terminated_at            TIMESTAMPTZ,
    termination_reason       TEXT,
    cancelled_reason         TEXT,
    breach_flagged_at        TIMESTAMPTZ,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (effective_to > effective_from),
    -- An accrual rate without eligibility would silently fund nothing.
    CHECK (mdf_accrual_bps = 0 OR mdf_eligible),
    CHECK (status = 'draft' OR sent_for_signature_at IS NOT NULL),
    CHECK (status NOT IN ('active', 'expired', 'terminated') OR activated_at IS NOT NULL),
    CHECK (status <> 'expired' OR expired_at IS NOT NULL),
    CHECK (status <> 'terminated' OR (terminated_at IS NOT NULL AND termination_reason IS NOT NULL)),
    CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);
CREATE INDEX prmc_contracts_partner_idx ON prmc_contracts (tenant_id, partner_id, status);
CREATE INDEX prmc_contracts_expiry_idx  ON prmc_contracts (tenant_id, effective_to)
    WHERE status = 'active';

-- One live trading relationship per partner; NDAs and MDF terms sit alongside.
CREATE UNIQUE INDEX prmc_contracts_one_active_trading_idx
    ON prmc_contracts (tenant_id, partner_id)
    WHERE status = 'active' AND type IN ('reseller', 'distribution', 'msp', 'referral');

CREATE TABLE prmc_contract_discount_lines (
    id                     TEXT    PRIMARY KEY,
    tenant_id              TEXT    NOT NULL,
    contract_id            TEXT    NOT NULL REFERENCES prmc_contracts (id) ON DELETE CASCADE,
    -- '*' is the catch-all line; anything else is a product category code.
    scope                  TEXT    NOT NULL CHECK (scope = '*' OR scope ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
    discount_bps           INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
    min_annual_volume_minor BIGINT CHECK (min_annual_volume_minor IS NULL OR min_annual_volume_minor >= 0),
    note                   TEXT,
    -- Resolution is "exact scope, else '*', else base discount", so a scope
    -- may appear at most once.
    UNIQUE (contract_id, scope)
);

CREATE TABLE prmc_contract_obligations (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    contract_id TEXT        NOT NULL REFERENCES prmc_contracts (id) ON DELETE CASCADE,
    code        TEXT        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
    description TEXT        NOT NULL CHECK (length(description) >= 1),
    due_at      TIMESTAMPTZ,
    status      TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'met', 'waived', 'breached')),
    evidence    TEXT,
    recorded_at TIMESTAMPTZ,
    recorded_by TEXT,
    UNIQUE (contract_id, code),
    CHECK (status = 'pending' OR (recorded_at IS NOT NULL AND recorded_by IS NOT NULL)),
    -- "Met" is an assertion someone has to back up.
    CHECK (status <> 'met' OR evidence IS NOT NULL)
);
CREATE INDEX prmc_contract_obligations_open_idx
    ON prmc_contract_obligations (tenant_id, due_at)
    WHERE status IN ('pending', 'breached');

CREATE TABLE prmc_contract_signatures (
    contract_id     TEXT        NOT NULL REFERENCES prmc_contracts (id) ON DELETE CASCADE,
    tenant_id       TEXT        NOT NULL,
    party           TEXT        NOT NULL CHECK (party IN ('partner', 'vendor')),
    signatory_name  TEXT        NOT NULL CHECK (length(signatory_name) >= 1),
    signatory_email TEXT        NOT NULL
        CHECK (signatory_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    signatory_title TEXT,
    signed_at       TIMESTAMPTZ NOT NULL,
    recorded_by     TEXT        NOT NULL,
    -- One signature per side...
    PRIMARY KEY (contract_id, party),
    -- ...and segregation of duties: the same mailbox cannot sign both sides.
    UNIQUE (contract_id, signatory_email)
);

CREATE TABLE prmc_contract_amendments (
    id                          TEXT        PRIMARY KEY,
    tenant_id                   TEXT        NOT NULL,
    contract_id                 TEXT        NOT NULL REFERENCES prmc_contracts (id) ON DELETE CASCADE,
    sequence                    INTEGER     NOT NULL CHECK (sequence >= 1),
    summary                     TEXT        NOT NULL CHECK (length(summary) >= 1),
    effective_from              TIMESTAMPTZ NOT NULL,
    previous_base_discount_bps  INTEGER     NOT NULL CHECK (previous_base_discount_bps BETWEEN 0 AND 10000),
    base_discount_bps           INTEGER     NOT NULL CHECK (base_discount_bps BETWEEN 0 AND 10000),
    previous_effective_to       TIMESTAMPTZ NOT NULL,
    effective_to                TIMESTAMPTZ NOT NULL,
    amended_by                  TEXT        NOT NULL,
    amended_at                  TIMESTAMPTZ NOT NULL,
    UNIQUE (contract_id, sequence),
    CHECK (effective_to > effective_from)
);
