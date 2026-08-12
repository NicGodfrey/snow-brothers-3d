-- Master data: transactional outbox for domain events.
-- Rows are written in the same transaction as the aggregate change and
-- published by a relay that marks published_at; the partial index keeps the
-- unpublished scan cheap.

CREATE TABLE mdm_outbox_events (
    event_id        TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    aggregate_type  TEXT        NOT NULL,
    aggregate_id    TEXT        NOT NULL,
    schema_version  SMALLINT    NOT NULL DEFAULT 1,
    payload         JSONB       NOT NULL,
    correlation_id  TEXT,
    causation_id    TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    published_at    TIMESTAMPTZ
);

CREATE INDEX mdm_outbox_unpublished_idx
    ON mdm_outbox_events (occurred_at)
    WHERE published_at IS NULL;
CREATE INDEX mdm_outbox_aggregate_idx
    ON mdm_outbox_events (tenant_id, aggregate_type, aggregate_id, occurred_at);
-- Downstream contexts subscribe by type (pricing wants FX, AR wants terms).
CREATE INDEX mdm_outbox_type_idx ON mdm_outbox_events (tenant_id, event_type, occurred_at);
