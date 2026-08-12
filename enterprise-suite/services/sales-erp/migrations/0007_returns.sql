-- Return authorizations (RMA) referencing shipped order lines.

CREATE TABLE sales.return_authorizations (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  rma_number       TEXT NOT NULL,
  order_id         TEXT NOT NULL REFERENCES sales.sales_orders (id),
  account_id       TEXT NOT NULL REFERENCES sales.accounts (id),
  currency         CHAR(3) NOT NULL,
  status           sales.rma_status NOT NULL DEFAULT 'requested',
  rejection_reason TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version          INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT rma_number_unique UNIQUE (tenant_id, rma_number),
  CONSTRAINT rma_rejection_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE INDEX rma_tenant_idx ON sales.return_authorizations (tenant_id);
CREATE INDEX rma_tenant_order_idx ON sales.return_authorizations (tenant_id, order_id);
CREATE INDEX rma_tenant_status_idx ON sales.return_authorizations (tenant_id, status);

CREATE TRIGGER rma_touch BEFORE UPDATE ON sales.return_authorizations
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();

CREATE TABLE sales.return_lines (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  rma_id            TEXT NOT NULL REFERENCES sales.return_authorizations (id) ON DELETE CASCADE,
  order_line_id     TEXT NOT NULL REFERENCES sales.sales_order_lines (id),
  sku               TEXT NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty >= 1),
  reason            sales.return_reason NOT NULL,
  -- Refund unit price frozen at request time (discounted order price).
  unit_refund_minor BIGINT NOT NULL CHECK (unit_refund_minor >= 0)
);

CREATE INDEX return_lines_tenant_rma_idx ON sales.return_lines (tenant_id, rma_id);
CREATE INDEX return_lines_order_line_idx ON sales.return_lines (tenant_id, order_line_id);
