-- Sales orders, order lines, and the credit decision captured at confirmation.

CREATE TABLE sales.sales_orders (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  order_number        TEXT NOT NULL,
  account_id          TEXT NOT NULL REFERENCES sales.accounts (id),
  quote_id            TEXT REFERENCES sales.quotes (id),
  currency            CHAR(3) NOT NULL,
  tax_region          CHAR(2) NOT NULL,
  status              sales.order_status NOT NULL DEFAULT 'draft',
  shipping_address    JSONB,
  cancellation_reason TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  version             INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT sales_orders_number_unique UNIQUE (tenant_id, order_number),
  CONSTRAINT sales_orders_cancel_reason CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE INDEX sales_orders_tenant_idx ON sales.sales_orders (tenant_id);
CREATE INDEX sales_orders_tenant_account_idx ON sales.sales_orders (tenant_id, account_id);
CREATE INDEX sales_orders_tenant_status_idx ON sales.sales_orders (tenant_id, status);
-- Credit exposure query: open orders per account.
CREATE INDEX sales_orders_exposure_idx ON sales.sales_orders (tenant_id, account_id)
  WHERE status IN ('confirmed', 'allocated', 'shipped');

CREATE TRIGGER sales_orders_touch BEFORE UPDATE ON sales.sales_orders
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();

CREATE TABLE sales.sales_order_lines (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  order_id         TEXT NOT NULL REFERENCES sales.sales_orders (id) ON DELETE CASCADE,
  position         INTEGER NOT NULL CHECK (position >= 1),
  sku              TEXT NOT NULL,
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty >= 1),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 60),
  tax_category     sales.tax_category NOT NULL DEFAULT 'standard',
  qty_allocated    INTEGER NOT NULL DEFAULT 0 CHECK (qty_allocated >= 0),
  qty_shipped      INTEGER NOT NULL DEFAULT 0 CHECK (qty_shipped >= 0),
  CONSTRAINT order_lines_position_unique UNIQUE (order_id, position),
  CONSTRAINT order_lines_allocation_bounds CHECK (qty_allocated <= qty),
  CONSTRAINT order_lines_shipment_bounds CHECK (qty_shipped <= qty_allocated)
);

CREATE INDEX sales_order_lines_tenant_order_idx ON sales.sales_order_lines (tenant_id, order_id);

-- Credit decision snapshot taken when the order was confirmed.
CREATE TABLE sales.order_credit_checks (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  order_id       TEXT NOT NULL REFERENCES sales.sales_orders (id) ON DELETE CASCADE,
  decision       sales.credit_decision NOT NULL,
  reasons        TEXT[] NOT NULL DEFAULT '{}',
  exposure_minor BIGINT NOT NULL,
  limit_minor    BIGINT,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_credit_checks_order_idx ON sales.order_credit_checks (tenant_id, order_id);
