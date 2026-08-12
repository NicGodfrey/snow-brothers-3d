-- integration-hub 0006: webhook deliveries and their attempt history
--
-- The endpoint, headers and body are snapshotted per delivery: editing a
-- subscription must not retroactively change what a queued delivery sends,
-- and support needs to see exactly what was transmitted.

CREATE TABLE integration.webhook_delivery (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    subscription_id TEXT        NOT NULL REFERENCES integration.webhook_subscription (id) ON DELETE CASCADE,
    event_id        TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    endpoint_url    TEXT        NOT NULL,
    headers         JSONB       NOT NULL DEFAULT '{}'::JSONB,
    body            TEXT        NOT NULL,
    timeout_ms      INTEGER     NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'in-flight', 'delivered', 'dead-lettered', 'cancelled')
    ),
    attempt_count   INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts    INTEGER     NOT NULL CHECK (max_attempts >= 1),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    available_at    TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    failure_reason  TEXT,
    cancel_reason   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT delivery_delivered_has_timestamp CHECK (
        status <> 'delivered' OR delivered_at IS NOT NULL
    ),
    CONSTRAINT delivery_dead_letter_has_reason CHECK (
        status <> 'dead-lettered' OR failure_reason IS NOT NULL
    ),
    CONSTRAINT delivery_cancelled_has_reason CHECK (
        status <> 'cancelled' OR cancel_reason IS NOT NULL
    ),
    -- One delivery per (subscription, event): fan-out must not duplicate.
    CONSTRAINT delivery_event_uq UNIQUE (subscription_id, event_id)
);

CREATE TABLE integration.webhook_delivery_attempt (
    delivery_id      TEXT        NOT NULL REFERENCES integration.webhook_delivery (id) ON DELETE CASCADE,
    attempt_number   INTEGER     NOT NULL CHECK (attempt_number >= 1),
    started_at       TIMESTAMPTZ NOT NULL,
    duration_ms      INTEGER     NOT NULL CHECK (duration_ms >= 0),
    outcome          TEXT        NOT NULL CHECK (
        outcome IN ('success', 'http-error', 'network-error', 'timeout', 'invalid-response')
    ),
    status_code      INTEGER     CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
    response_snippet TEXT        CHECK (response_snippet IS NULL OR length(response_snippet) <= 512),
    error            TEXT,
    PRIMARY KEY (delivery_id, attempt_number),
    CONSTRAINT attempt_http_outcome_has_status CHECK (
        outcome <> 'http-error' OR status_code IS NOT NULL
    ),
    CONSTRAINT attempt_success_has_status CHECK (outcome <> 'success' OR status_code IS NOT NULL)
);

-- The dispatcher poll.
CREATE INDEX delivery_due_ix ON integration.webhook_delivery (available_at)
    WHERE status = 'pending';
CREATE INDEX delivery_subscription_ix
    ON integration.webhook_delivery (tenant_id, subscription_id, scheduled_at DESC);
CREATE INDEX delivery_status_ix ON integration.webhook_delivery (tenant_id, status);
CREATE INDEX delivery_event_ix ON integration.webhook_delivery (tenant_id, event_id);
CREATE INDEX delivery_dead_letters_ix ON integration.webhook_delivery (tenant_id, updated_at)
    WHERE status = 'dead-lettered';

CREATE TRIGGER delivery_touch BEFORE UPDATE ON integration.webhook_delivery
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
