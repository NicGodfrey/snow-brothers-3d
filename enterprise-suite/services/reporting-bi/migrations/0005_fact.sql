-- reporting-bi 0005: fact storage
--
-- Facts are immutable. A correction arrives as a new fact (a reversal),
-- never as an UPDATE, which is what makes any query at any grain a pure fold
-- over rows and what lets the table be append-only and partitioned by time.
--
-- Dimensions and measures are JSONB rather than physical columns. The
-- alternative — a table per cube, migrated whenever an analyst adds a
-- measure — trades a schema migration for every catalog change, which is the
-- opposite of what a semantic layer is for. The cube definition is the
-- schema; ingest validates against it, so the JSONB is not a free-for-all.

CREATE TABLE reporting.fact_record (
    fact_id      TEXT        NOT NULL,
    tenant_id    TEXT        NOT NULL,
    cube         reporting.cube_name NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL,
    dimensions   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    measures     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    currency     CHAR(3),
    -- Provenance: the event this row was projected from, and the mapping
    -- revision that did it. This is both the idempotency key for ingest and
    -- the answer to "why does this number say 41?".
    source_event_id    TEXT NOT NULL,
    source_event_type  reporting.event_type NOT NULL,
    source_aggregate_type TEXT NOT NULL,
    source_aggregate_id   TEXT NOT NULL,
    mapping_version    INTEGER NOT NULL DEFAULT 1,
    -- Position within the facts one event produced, so a single event
    -- fanning out to several rows stays replay-safe.
    fact_seq     SMALLINT    NOT NULL DEFAULT 0,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The partition key has to be part of every unique constraint, hence its
    -- presence in the keys below.
    PRIMARY KEY (fact_id, occurred_at),
    CONSTRAINT fact_idempotent_uq
        UNIQUE (tenant_id, cube, source_event_id, fact_seq, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Monthly partitions. A deployment creates them ahead of time (pg_partman or
-- a cron job); the default partition catches anything that arrives outside
-- the provisioned window so late or clock-skewed events are never lost.
CREATE TABLE reporting.fact_record_default PARTITION OF reporting.fact_record DEFAULT;

-- The scan every query starts from: one cube, one tenant, a time window.
CREATE INDEX fact_scan_ix
    ON reporting.fact_record (tenant_id, cube, occurred_at);

-- Ingest's duplicate check, which runs once per inbound event.
CREATE INDEX fact_source_event_ix
    ON reporting.fact_record (tenant_id, source_event_id);

-- Pre-filtering by dimension member before aggregation, e.g. one warehouse.
CREATE INDEX fact_dimensions_ix
    ON reporting.fact_record USING gin (dimensions jsonb_path_ops);

CREATE INDEX fact_event_type_ix
    ON reporting.fact_record (tenant_id, source_event_type, occurred_at);

-- Immutability, enforced rather than documented: without this, a well-meant
-- "fix" to one row silently changes every historical report that read it.
CREATE OR REPLACE FUNCTION reporting.reject_fact_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'facts are immutable; post a reversing fact instead (fact_id %)', OLD.fact_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fact_record_no_update BEFORE UPDATE ON reporting.fact_record
    FOR EACH ROW EXECUTE FUNCTION reporting.reject_fact_mutation();

-- Freshness per cube, read by dashboards ("sales data as of 09:42") and by
-- the query cache key.
CREATE OR REPLACE VIEW reporting.cube_freshness AS
    SELECT tenant_id,
           cube,
           count(*)          AS fact_count,
           max(occurred_at)  AS latest_fact_at,
           max(ingested_at)  AS latest_ingest_at
      FROM reporting.fact_record
     GROUP BY tenant_id, cube;
