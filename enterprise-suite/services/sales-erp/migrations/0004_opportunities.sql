-- Opportunity pipeline.

CREATE TABLE sales.opportunities (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  account_id          TEXT NOT NULL REFERENCES sales.accounts (id),
  name                TEXT NOT NULL,
  stage               sales.opportunity_stage NOT NULL DEFAULT 'prospecting',
  amount_minor        BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency            CHAR(3) NOT NULL,
  probability         SMALLINT NOT NULL CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  owner_id            TEXT,
  source              TEXT,
  lost_reason         TEXT,
  won_quote_id        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  version             INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT opportunities_lost_reason CHECK (stage <> 'closed_lost' OR lost_reason IS NOT NULL)
);

CREATE INDEX opportunities_tenant_idx ON sales.opportunities (tenant_id);
CREATE INDEX opportunities_tenant_account_idx ON sales.opportunities (tenant_id, account_id);
CREATE INDEX opportunities_tenant_stage_idx ON sales.opportunities (tenant_id, stage);

CREATE TRIGGER opportunities_touch BEFORE UPDATE ON sales.opportunities
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();
