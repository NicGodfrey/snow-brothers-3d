-- Transactional outbox for domain events and per-tenant document sequences.

CREATE TABLE sales.outbox_events (
  event_id       TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload        JSONB NOT NULL,
  correlation_id TEXT,
  causation_id   TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);

-- Relay poller: oldest unpublished first.
CREATE INDEX outbox_unpublished_idx ON sales.outbox_events (occurred_at) WHERE published_at IS NULL;
CREATE INDEX outbox_tenant_type_idx ON sales.outbox_events (tenant_id, event_type);
CREATE INDEX outbox_aggregate_idx ON sales.outbox_events (aggregate_type, aggregate_id);

-- Per-tenant, per-document-kind numbering (Q-00001, SO-00001, RMA-00001, ACC-00001).
CREATE TABLE sales.document_sequences (
  tenant_id  TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('account', 'quote', 'order', 'rma')),
  next_value BIGINT NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (tenant_id, kind)
);

-- Atomic take-next helper used by the application layer.
CREATE OR REPLACE FUNCTION sales.next_document_number(p_tenant_id TEXT, p_kind TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_next BIGINT;
BEGIN
  INSERT INTO sales.document_sequences (tenant_id, kind, next_value)
  VALUES (p_tenant_id, p_kind, 2)
  ON CONFLICT (tenant_id, kind)
  DO UPDATE SET next_value = sales.document_sequences.next_value + 1
  RETURNING next_value - 1 INTO v_next;
  RETURN v_next;
END;
$$ LANGUAGE plpgsql;
