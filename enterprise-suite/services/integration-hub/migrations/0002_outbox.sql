-- integration-hub 0002: relay outbox
--
-- Domain services insert their events here (or POST them to /outbox); relay
-- workers claim rows under a lease, publish, and acknowledge. The partial
-- index on claimable rows keeps the polling query cheap as the published
-- history grows.

CREATE TABLE integration.outbox_message (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    source            TEXT        NOT NULL,
    -- event envelope
    event_id          TEXT        NOT NULL,
    event_type        integration.event_type NOT NULL,
    aggregate_type    TEXT        NOT NULL,
    aggregate_id      TEXT        NOT NULL,
    occurred_at       TIMESTAMPTZ NOT NULL,
    schema_version    INTEGER     NOT NULL DEFAULT 1,
    payload           JSONB       NOT NULL,
    correlation_id    TEXT,
    causation_id      TEXT,
    -- relay state
    status            TEXT        NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'in-flight', 'published', 'dead-lettered')
    ),
    attempts          INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts      INTEGER     NOT NULL DEFAULT 8 CHECK (max_attempts >= 1),
    available_at      TIMESTAMPTZ NOT NULL,
    partition_key     TEXT        NOT NULL,
    enqueued_at       TIMESTAMPTZ NOT NULL,
    lease_owner       TEXT,
    lease_acquired_at TIMESTAMPTZ,
    lease_expires_at  TIMESTAMPTZ,
    last_error        TEXT,
    last_error_at     TIMESTAMPTZ,
    published_at      TIMESTAMPTZ,
    dead_letter_reason TEXT,
    replay_count      INTEGER     NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER     NOT NULL DEFAULT 1,
    -- ingestion is idempotent per (tenant, source, event)
    CONSTRAINT outbox_source_event_uq UNIQUE (tenant_id, source, event_id),
    CONSTRAINT outbox_lease_is_complete CHECK (
        (lease_owner IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
    CONSTRAINT outbox_in_flight_has_lease CHECK (
        status <> 'in-flight' OR lease_owner IS NOT NULL
    ),
    CONSTRAINT outbox_published_has_timestamp CHECK (
        status <> 'published' OR published_at IS NOT NULL
    ),
    CONSTRAINT outbox_dead_letter_has_reason CHECK (
        status <> 'dead-lettered' OR dead_letter_reason IS NOT NULL
    )
);

-- The relay poll: claimable rows, oldest first.
CREATE INDEX outbox_claimable_ix ON integration.outbox_message (available_at, enqueued_at)
    WHERE status = 'pending';

-- Reclaiming after a worker dies.
CREATE INDEX outbox_expired_lease_ix ON integration.outbox_message (lease_expires_at)
    WHERE status = 'in-flight';

-- Per-aggregate ordering: only one in-flight message per partition.
CREATE UNIQUE INDEX outbox_one_in_flight_per_partition_ux
    ON integration.outbox_message (tenant_id, partition_key)
    WHERE status = 'in-flight';

CREATE INDEX outbox_status_ix ON integration.outbox_message (tenant_id, status);
CREATE INDEX outbox_event_type_ix ON integration.outbox_message (tenant_id, event_type);
CREATE INDEX outbox_dead_letters_ix ON integration.outbox_message (tenant_id, updated_at)
    WHERE status = 'dead-lettered';

CREATE TRIGGER outbox_touch BEFORE UPDATE ON integration.outbox_message
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
