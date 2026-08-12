-- Accounts (sales view of customers) and contacts.

CREATE TABLE sales.accounts (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  account_number     TEXT NOT NULL,
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  account_type       sales.account_type NOT NULL,
  status             sales.account_status NOT NULL DEFAULT 'active',
  industry           TEXT,
  website            TEXT,
  currency           CHAR(3) NOT NULL,
  payment_terms      sales.payment_terms NOT NULL DEFAULT 'NET30',
  -- NULL means "no limit configured"; integer minor units otherwise.
  credit_limit_minor BIGINT CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  credit_hold        BOOLEAN NOT NULL DEFAULT FALSE,
  credit_hold_reason TEXT,
  billing_address    JSONB,
  shipping_address   JSONB,
  owner_id           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  version            INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT accounts_number_unique UNIQUE (tenant_id, account_number),
  CONSTRAINT accounts_hold_reason CHECK (NOT credit_hold OR credit_hold_reason IS NOT NULL)
);

CREATE INDEX accounts_tenant_idx ON sales.accounts (tenant_id);
CREATE INDEX accounts_tenant_type_idx ON sales.accounts (tenant_id, account_type);
CREATE INDEX accounts_tenant_status_idx ON sales.accounts (tenant_id, status);
CREATE INDEX accounts_name_search_idx ON sales.accounts (tenant_id, lower(name));

CREATE TRIGGER accounts_touch BEFORE UPDATE ON sales.accounts
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();

CREATE TABLE sales.contacts (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES sales.accounts (id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  role       sales.contact_role NOT NULL DEFAULT 'other',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX contacts_tenant_account_idx ON sales.contacts (tenant_id, account_id);
-- One active contact per email per account.
CREATE UNIQUE INDEX contacts_active_email_unique
  ON sales.contacts (tenant_id, account_id, lower(email)) WHERE active;
-- At most one primary contact per account.
CREATE UNIQUE INDEX contacts_single_primary
  ON sales.contacts (tenant_id, account_id) WHERE is_primary;

CREATE TRIGGER contacts_touch BEFORE UPDATE ON sales.contacts
  FOR EACH ROW EXECUTE FUNCTION sales.touch_row();
