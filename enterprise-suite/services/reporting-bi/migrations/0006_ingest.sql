-- reporting-bi 0006: ingest bookkeeping — dead letters and watermarks
--
-- Two things make a warehouse diagnosable when the numbers look wrong:
-- knowing what was rejected and why, and knowing how far the ingest has got.
-- An empty dashboard with a full dead-letter table is a solvable problem; an
-- empty dashboard with nothing behind it is a mystery.

CREATE TABLE reporting.dead_letter (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    event_id    TEXT        NOT NULL,
    event_type  reporting.event_type NOT NULL,
    source      TEXT        NOT NULL,
    reason      TEXT        NOT NULL CHECK (
        reason IN ('no-mapping', 'invalid-payload', 'mapping-failed')
    ),
    message     TEXT        NOT NULL,
    -- The original payload, kept verbatim so a fixed mapping can be replayed
    -- against it without asking the source system to resend.
    payload     JSONB,
    replayed_at TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dead_letter_recent_ix
    ON reporting.dead_letter (tenant_id, recorded_at DESC);
CREATE INDEX dead_letter_reason_ix
    ON reporting.dead_letter (tenant_id, reason, recorded_at DESC);
CREATE INDEX dead_letter_event_type_ix
    ON reporting.dead_letter (tenant_id, event_type);
-- The replay queue: what is still outstanding.
CREATE INDEX dead_letter_unreplayed_ix
    ON reporting.dead_letter (tenant_id, recorded_at)
    WHERE replayed_at IS NULL;

-- One row per bounded context that feeds the warehouse. last_occurred_at is
-- the freshness signal; it only ever moves forward, because out-of-order
-- delivery must not make a dashboard claim it went stale.
CREATE TABLE reporting.ingest_watermark (
    tenant_id        TEXT        NOT NULL,
    source           TEXT        NOT NULL,
    last_event_id    TEXT        NOT NULL,
    last_event_type  reporting.event_type NOT NULL,
    last_occurred_at TIMESTAMPTZ NOT NULL,
    last_ingested_at TIMESTAMPTZ NOT NULL,
    event_count      BIGINT      NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    fact_count       BIGINT      NOT NULL DEFAULT 0 CHECK (fact_count >= 0),
    PRIMARY KEY (tenant_id, source)
);

CREATE OR REPLACE FUNCTION reporting.watermark_never_rewinds()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.last_occurred_at < OLD.last_occurred_at THEN
        NEW.last_occurred_at := OLD.last_occurred_at;
        NEW.last_event_id    := OLD.last_event_id;
        NEW.last_event_type  := OLD.last_event_type;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ingest_watermark_monotonic BEFORE UPDATE ON reporting.ingest_watermark
    FOR EACH ROW EXECUTE FUNCTION reporting.watermark_never_rewinds();

-- Lag per source, which is what an ingest health check alerts on.
CREATE OR REPLACE VIEW reporting.ingest_lag AS
    SELECT tenant_id,
           source,
           last_occurred_at,
           last_ingested_at,
           now() - last_occurred_at AS behind_source,
           last_ingested_at - last_occurred_at AS pipeline_latency,
           event_count,
           fact_count
      FROM reporting.ingest_watermark;
