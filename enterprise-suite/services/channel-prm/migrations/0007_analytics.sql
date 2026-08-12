-- Channel PRM: reporting views and the snapshot table behind partner scorecards.
--
-- The roll-ups are computed in the application from the pure functions in
-- domain/pipeline, which is what tests exercise. These views exist so a BI
-- tool reading the database directly sees the same definitions rather than
-- inventing its own.

-- Open pipeline: only registrations that still occupy the customer space, in
-- an open stage. Weighted value is always derived from probability, never
-- stored, so a probability correction cannot leave a stale figure behind.
CREATE VIEW prm_v_open_pipeline AS
SELECT r.tenant_id,
       r.id                AS registration_id,
       r.number,
       r.partner_id,
       p.tier,
       r.stage,
       r.probability,
       r.currency,
       r.estimated_value_minor,
       round(r.estimated_value_minor * r.probability / 100.0) AS weighted_value_minor,
       r.source,
       r.customer_key,
       r.expected_close_date,
       r.protection_ends_at,
       r.updated_at        AS last_activity_at
FROM prm_deal_registrations r
JOIN prm_partners p ON p.id = r.partner_id
WHERE r.status IN ('submitted', 'under_review', 'approved')
  AND r.stage IN ('prospect', 'qualified', 'proposal', 'negotiation');

-- Protection currently in force, with the countdown the portal shows.
CREATE VIEW prm_v_active_protection AS
SELECT r.tenant_id,
       r.id AS registration_id,
       r.number,
       r.partner_id,
       r.customer_key,
       r.protection_starts_at,
       r.protection_ends_at,
       ceil(EXTRACT(EPOCH FROM (r.protection_ends_at - now())) / 86400.0) AS remaining_days,
       r.estimated_value_minor,
       r.currency
FROM prm_deal_registrations r
WHERE r.status = 'approved'
  AND r.protection_starts_at <= now()
  AND r.protection_ends_at > now();

-- Partner performance, one row per partner and currency. Cancelled orders
-- contribute nothing; won/lost counts drive the win rate the scorecard uses.
CREATE VIEW prm_v_partner_performance AS
SELECT p.tenant_id,
       p.id AS partner_id,
       p.code,
       p.tier,
       o.currency,
       count(DISTINCT o.id) FILTER (WHERE o.status <> 'cancelled')            AS order_count,
       coalesce(sum(o.net_value_minor) FILTER (WHERE o.status <> 'cancelled'), 0) AS booked_value_minor,
       coalesce(sum(o.net_value_minor) FILTER (
           WHERE o.status <> 'cancelled' AND o.registration_id IS NOT NULL), 0)   AS registered_value_minor
FROM prm_partners p
LEFT JOIN prm_channel_orders o ON o.partner_id = p.id
GROUP BY p.tenant_id, p.id, p.code, p.tier, o.currency;

-- Sourced vs influenced. Co-sell stays in its own column rather than being
-- folded into either side, which is how channel revenue reporting stops
-- adding up to more than the business booked.
CREATE VIEW prm_v_source_split AS
SELECT tenant_id,
       currency,
       date_trunc('month', ordered_at)                                        AS period,
       coalesce(sum(net_value_minor) FILTER (WHERE source_type = 'partner_sourced'), 0) AS partner_sourced_minor,
       coalesce(sum(net_value_minor) FILTER (WHERE source_type = 'vendor_sourced'), 0)  AS vendor_sourced_minor,
       coalesce(sum(net_value_minor) FILTER (WHERE source_type = 'co_sell'), 0)         AS co_sell_minor
FROM prm_channel_orders
WHERE status <> 'cancelled'
GROUP BY tenant_id, currency, date_trunc('month', ordered_at);

-- Registration cohorts by submission month: conversion is only comparable
-- across periods when deals are grouped by when they entered, not when they
-- closed.
CREATE VIEW prm_v_registration_cohorts AS
SELECT tenant_id,
       currency,
       date_trunc('month', submitted_at) AS cohort_month,
       count(*)                                                       AS registrations,
       count(*) FILTER (WHERE status = 'closed_won')                  AS won,
       count(*) FILTER (WHERE status = 'closed_lost')                 AS lost,
       count(*) FILTER (WHERE status IN ('submitted', 'under_review', 'approved')) AS still_open,
       coalesce(sum(estimated_value_minor), 0)                        AS registered_value_minor,
       coalesce(sum(closed_value_minor) FILTER (WHERE status = 'closed_won'), 0) AS won_value_minor
FROM prm_deal_registrations
WHERE submitted_at IS NOT NULL
GROUP BY tenant_id, currency, date_trunc('month', submitted_at);

-- Materialized scorecards. Written by the scheduled analytics job so a partner
-- portal never recomputes the composite on request; `components` keeps the
-- per-factor breakdown that makes a score defensible in a QBR.
CREATE TABLE prm_partner_scorecards (
    tenant_id           TEXT        NOT NULL,
    partner_id          TEXT        NOT NULL REFERENCES prm_partners (id) ON DELETE CASCADE,
    period              DATE        NOT NULL,
    currency            CHAR(3)     NOT NULL,
    score               SMALLINT    NOT NULL CHECK (score BETWEEN 0 AND 100),
    booked_value_minor  BIGINT      NOT NULL DEFAULT 0,
    win_rate_bps        INTEGER     NOT NULL DEFAULT 0 CHECK (win_rate_bps BETWEEN 0 AND 10000),
    approval_rate_bps   INTEGER     NOT NULL DEFAULT 0 CHECK (approval_rate_bps BETWEEN 0 AND 10000),
    average_cycle_days  SMALLINT,
    conflict_count      SMALLINT    NOT NULL DEFAULT 0,
    components          JSONB       NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, partner_id, period)
);
CREATE INDEX prm_partner_scorecards_period_idx ON prm_partner_scorecards (tenant_id, period, score DESC);
