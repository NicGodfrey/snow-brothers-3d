-- Transactional outbox. Domain events are inserted in the same
-- transaction as the aggregate write; a relay polls pending rows and
-- publishes them to the event bus.

CREATE TABLE outbox_events (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    event_id        TEXT NOT NULL UNIQUE,
    event_type      TEXT NOT NULL,
    aggregate_type  TEXT NOT NULL,
    aggregate_id    TEXT NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    payload         JSONB NOT NULL,
    correlation_id  TEXT,
    causation_id    TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'published', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ
);

-- Relay scans: oldest pending first.
CREATE INDEX idx_outbox_pending ON outbox_events (enqueued_at) WHERE status = 'pending';
CREATE INDEX idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id);
