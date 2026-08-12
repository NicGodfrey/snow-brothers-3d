-- PRM core: the tier program.
--
-- A tier is a rank plus the requirements a partner must satisfy to earn it and
-- the benefits it carries. Requirements and benefits are stored as JSONB
-- because the qualification engine treats them as an open policy document; the
-- fields the engine reads today are documented against each column.

CREATE TABLE prmc_tier_definitions (
    id           TEXT        PRIMARY KEY,
    tenant_id    TEXT        NOT NULL,
    code         TEXT        NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{1,30}$'),
    name         TEXT        NOT NULL CHECK (length(name) >= 1),
    -- Higher rank wins; ranks are sparse (10/20/30/40) so tiers can be slotted in.
    rank         INTEGER     NOT NULL CHECK (rank BETWEEN 0 AND 100),
    --   {"minTrailingRevenueMinor"?, "minCertifiedIndividuals"?,
    --    "requiredCertificationCodes"?, "minDealsWon"?, "minMonthsActive"?,
    --    "requiresSignedContract"?}
    requirements JSONB       NOT NULL DEFAULT '{}',
    --   {"baseDiscountBps", "dealRegistrationBonusBps", "mdfAccrualBps",
    --    "mdfRequestCapBps", "leadSharing", "namedChannelManager",
    --    "supportLevel", "nfrSeats"}
    benefits     JSONB       NOT NULL,
    currency     CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    -- Two tiers at the same rank make "the next tier up" ambiguous.
    UNIQUE (tenant_id, rank),
    CHECK (benefits ? 'baseDiscountBps' AND benefits ? 'mdfAccrualBps' AND benefits ? 'supportLevel'),
    CHECK ((benefits ->> 'baseDiscountBps')::INTEGER BETWEEN 0 AND 10000),
    CHECK ((benefits ->> 'mdfAccrualBps')::INTEGER BETWEEN 0 AND 10000),
    CHECK (benefits ->> 'supportLevel' IN ('standard', 'priority', 'dedicated'))
);
CREATE INDEX prmc_tier_definitions_rank_idx ON prmc_tier_definitions (tenant_id, rank DESC)
    WHERE active;
