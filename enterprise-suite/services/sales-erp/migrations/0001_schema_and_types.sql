-- Sales bounded context: schema, enums, shared trigger.
-- Runtime is currently in-memory; this DDL is the target Postgres shape.

CREATE SCHEMA IF NOT EXISTS sales;

CREATE TYPE sales.account_type AS ENUM ('prospect', 'customer', 'partner');
CREATE TYPE sales.account_status AS ENUM ('active', 'on_hold', 'closed');
CREATE TYPE sales.payment_terms AS ENUM ('DUE_ON_RECEIPT', 'NET15', 'NET30', 'NET45', 'NET60');
CREATE TYPE sales.contact_role AS ENUM ('decision_maker', 'influencer', 'billing', 'technical', 'other');
CREATE TYPE sales.tax_category AS ENUM ('standard', 'reduced', 'zero', 'exempt');
CREATE TYPE sales.opportunity_stage AS ENUM (
  'prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'
);
CREATE TYPE sales.quote_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'rejected', 'accepted', 'expired', 'cancelled'
);
CREATE TYPE sales.order_status AS ENUM (
  'draft', 'confirmed', 'allocated', 'shipped', 'invoiced', 'closed', 'cancelled'
);
CREATE TYPE sales.rma_status AS ENUM (
  'requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'
);
CREATE TYPE sales.return_reason AS ENUM (
  'damaged', 'wrong_item', 'not_as_described', 'no_longer_needed', 'other'
);
CREATE TYPE sales.credit_decision AS ENUM ('approved', 'review_required', 'declined');

-- Shared optimistic-locking / audit trigger.
CREATE OR REPLACE FUNCTION sales.touch_row() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
