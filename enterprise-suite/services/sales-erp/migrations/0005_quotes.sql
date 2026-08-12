-- Quotes and quote lines.

CREATE TABLE sales.quotes (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  quote_number     TEXT NOT NULL,
  account_id       TEXT NOT NULL REFERENCES sales.accounts (id),
  opportunity_id   TEXT REFERENCES sales.opportunities (id),
  currency         CHAR(3) NOT NULL,
  tax_region       CHAR(2) NOT NULL,
  status           sales.quote_status NOT NULL DEFAULT 'draft',
  revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  valid_until      DATE NOT NULL,
  notes            TEXT,
  submitted_by     TEXT,
  approved_by      TEXT,
  rejection_reason TEXT,
  accepted_at      DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version          INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT quotes_number_unique UNIQUE (tenant_id, quote_number),
  CONSTRAINT quotes_rejection_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE INDEX quotes_tenant_idx ON sales.quotes (tenant_id);
CREATE INDEX quotes_tenant_account_idx ON sales.quotes (tenant_id, account_id);
CREATE INDEX quotes_tenant_status_idx ON sales.quotes (tenant_id, status);
-- Validity sweep scans approved quotes by date.
CREATE INDEX quotes_expiry_sweep_idx ON sales.quotes (tenant_id, valid_until) WHERE status = 'approved';

CREATE TRIGGER quotes_touch BEFORE UPDATE ON sales.quotes
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();

CREATE TABLE sales.quote_lines (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  quote_id         TEXT NOT NULL REFERENCES sales.quotes (id) ON DELETE CASCADE,
  position         INTEGER NOT NULL CHECK (position >= 1),
  sku              TEXT NOT NULL,
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty >= 1),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 60),
  tax_category     sales.tax_category NOT NULL DEFAULT 'standard',
  CONSTRAINT quote_lines_position_unique UNIQUE (quote_id, position)
);

CREATE INDEX quote_lines_tenant_quote_idx ON sales.quote_lines (tenant_id, quote_id);
