-- reporting-bi 0001: schema, shared helpers and the date-bucketing function
--
-- Everything lives in the `reporting` schema and every table carries
-- tenant_id as the leading column of its keys and indexes. A warehouse that
-- can accidentally read another tenant's facts is the worst failure mode in
-- this context, so tenancy is structural rather than a convention.

CREATE SCHEMA IF NOT EXISTS reporting;

-- Needed by the tile-overlap exclusion constraint in 0008, which mixes an
-- equality column with a GiST-indexed geometry.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Bumps updated_at/version on every UPDATE, mirroring the optimistic
-- concurrency the aggregates keep in memory.
CREATE OR REPLACE FUNCTION reporting.touch_row()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Naming rules are enforced in the database as well as the domain: these
-- identifiers end up as column headers, CSV fields and expression tokens,
-- and a stray space or dot there breaks the expression parser.
CREATE DOMAIN reporting.snake_code AS TEXT
    CHECK (VALUE ~ '^[a-z][a-z0-9_]{1,63}$');

CREATE DOMAIN reporting.cube_name AS TEXT
    CHECK (VALUE ~ '^[a-z][a-z0-9_]{2,63}$');

CREATE DOMAIN reporting.kebab_code AS TEXT
    CHECK (VALUE ~ '^[a-z][a-z0-9-]{2,63}$');

CREATE DOMAIN reporting.event_type AS TEXT
    CHECK (VALUE ~ '^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$');

CREATE DOMAIN reporting.time_grain AS TEXT
    CHECK (VALUE IN ('hour', 'day', 'week', 'month', 'quarter', 'year'));

CREATE DOMAIN reporting.metric_unit AS TEXT
    CHECK (VALUE IN ('count', 'currency', 'quantity', 'ratio', 'percent', 'days', 'seconds'));

CREATE DOMAIN reporting.metric_direction AS TEXT
    CHECK (VALUE IN ('higher-is-better', 'lower-is-better', 'neutral'));

-- The SQL twin of `periodKey()` in domain/time-grain.ts. Keeping the two in
-- step is what allows a Postgres-backed fact repository to push GROUP BY
-- down to the database and still produce keys the engine, the dashboards and
-- the stored KPI snapshots already agree on.
--
-- Sortable text rather than a date, for the same reason as in TypeScript: a
-- period key doubles as a group key and an ORDER BY value.
CREATE OR REPLACE FUNCTION reporting.period_key(at TIMESTAMPTZ, grain reporting.time_grain)
RETURNS TEXT AS $$
    SELECT CASE grain
        WHEN 'hour'    THEN to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24')
        WHEN 'day'     THEN to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        -- IYYY/IW are ISO week-numbering year and week, matching isoWeek().
        WHEN 'week'    THEN to_char(at AT TIME ZONE 'UTC', 'IYYY"-W"IW')
        WHEN 'month'   THEN to_char(at AT TIME ZONE 'UTC', 'YYYY-MM')
        WHEN 'quarter' THEN to_char(at AT TIME ZONE 'UTC', 'YYYY"-Q"Q')
        WHEN 'year'    THEN to_char(at AT TIME ZONE 'UTC', 'YYYY')
    END;
$$ LANGUAGE sql IMMUTABLE STRICT;

-- Bucket start instant, for range math and for densifying a series.
CREATE OR REPLACE FUNCTION reporting.bucket_start(at TIMESTAMPTZ, grain reporting.time_grain)
RETURNS TIMESTAMPTZ AS $$
    SELECT date_trunc(
        CASE grain WHEN 'hour' THEN 'hour'
                   WHEN 'day' THEN 'day'
                   WHEN 'week' THEN 'week'
                   WHEN 'month' THEN 'month'
                   WHEN 'quarter' THEN 'quarter'
                   WHEN 'year' THEN 'year' END,
        at AT TIME ZONE 'UTC'
    ) AT TIME ZONE 'UTC';
$$ LANGUAGE sql IMMUTABLE STRICT;
