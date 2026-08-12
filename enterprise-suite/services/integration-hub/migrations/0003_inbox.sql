-- integration-hub 0003: inbox
--
-- Inbound messages are recorded before they are processed. The unique key on
-- (tenant, source, message_key) is the de-duplication guarantee: a partner
-- retrying a delivery hits a conflict instead of re-running the handler.
-- `checksum` lets us tell an honest retry from key reuse with new content.

CREATE TABLE integration.inbox_message (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    source         TEXT        NOT NULL,
    message_key    TEXT        NOT NULL,
    event_type     integration.event_type NOT NULL,
    payload        JSONB       NOT NULL,
    checksum       TEXT        NOT NULL,
    headers        JSONB       NOT NULL DEFAULT '{}'::JSONB,
    status         TEXT        NOT NULL DEFAULT 'received' CHECK (
        status IN ('received', 'processing', 'processed', 'failed', 'discarded')
    ),
    attempts       INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts   INTEGER     NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    received_at    TIMESTAMPTZ NOT NULL,
    available_at   TIMESTAMPTZ NOT NULL,
    processed_at   TIMESTAMPTZ,
    last_error     TEXT,
    last_error_at  TIMESTAMPTZ,
    discard_reason TEXT,
    duplicate_count INTEGER    NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
    result         JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT inbox_key_uq UNIQUE (tenant_id, source, message_key),
    CONSTRAINT inbox_processed_has_timestamp CHECK (
        status <> 'processed' OR processed_at IS NOT NULL
    ),
    CONSTRAINT inbox_discarded_has_reason CHECK (
        status <> 'discarded' OR discard_reason IS NOT NULL
    )
);

CREATE INDEX inbox_due_ix ON integration.inbox_message (available_at)
    WHERE status = 'received';
CREATE INDEX inbox_status_ix ON integration.inbox_message (tenant_id, status);
CREATE INDEX inbox_source_ix ON integration.inbox_message (tenant_id, source, received_at DESC);
CREATE INDEX inbox_event_type_ix ON integration.inbox_message (tenant_id, event_type);
CREATE INDEX inbox_failed_ix ON integration.inbox_message (tenant_id, updated_at)
    WHERE status = 'failed';

CREATE TRIGGER inbox_touch BEFORE UPDATE ON integration.inbox_message
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
