-- integration-hub 0001: schema and shared helpers
--
-- Every table in this service lives in the `integration` schema and carries
-- tenant_id as the first column of its natural keys and indexes: the hub is
-- multi-tenant and no query is allowed to cross a tenant boundary.

CREATE SCHEMA IF NOT EXISTS integration;

-- Bumps updated_at/version on every UPDATE so optimistic concurrency in the
-- aggregates has a database-side counterpart.
CREATE OR REPLACE FUNCTION integration.touch_row()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Shared enumerations. Kept as domains over TEXT with CHECK constraints
-- rather than PostgreSQL ENUMs, so adding a value is a cheap migration.
CREATE DOMAIN integration.event_type AS TEXT
    CHECK (VALUE ~ '^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$');

CREATE DOMAIN integration.topic_pattern AS TEXT
    CHECK (VALUE ~ '^(\*{1,2}|[a-z0-9][a-z0-9-]*)(\.(\*{1,2}|[a-z0-9][a-z0-9-]*))*$');
