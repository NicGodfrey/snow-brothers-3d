-- Price lists with quantity-tiered item prices.

CREATE TABLE sales.price_lists (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  currency    CHAR(3) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  valid_from  DATE,
  valid_until DATE,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  version     INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT price_lists_validity CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until
  )
);

CREATE INDEX price_lists_tenant_idx ON sales.price_lists (tenant_id);
-- One active default list per currency per tenant.
CREATE UNIQUE INDEX price_lists_single_default
  ON sales.price_lists (tenant_id, currency) WHERE is_default AND status = 'active';

CREATE TRIGGER price_lists_touch BEFORE UPDATE ON sales.price_lists
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();

CREATE TABLE sales.price_list_items (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  price_list_id TEXT NOT NULL REFERENCES sales.price_lists (id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  description   TEXT NOT NULL,
  tax_category  sales.tax_category NOT NULL DEFAULT 'standard',
  CONSTRAINT price_list_items_sku_unique UNIQUE (price_list_id, sku)
);

CREATE INDEX price_list_items_tenant_idx ON sales.price_list_items (tenant_id, price_list_id);

CREATE TABLE sales.price_list_item_tiers (
  id               TEXT PRIMARY KEY,
  item_id          TEXT NOT NULL REFERENCES sales.price_list_items (id) ON DELETE CASCADE,
  min_qty          INTEGER NOT NULL CHECK (min_qty >= 1),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  CONSTRAINT tiers_min_qty_unique UNIQUE (item_id, min_qty)
);
