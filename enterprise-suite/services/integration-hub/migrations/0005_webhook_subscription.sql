-- integration-hub 0005: webhook subscriptions
--
-- `secret` is the current HMAC signing key; `previous_secret` keeps the
-- rotated-out key valid until `previous_secret_expires_at` so a receiver has
-- a window to switch. Consecutive failures drive the circuit breaker that
-- auto-disables an endpoint.

CREATE TABLE integration.webhook_subscription (
    id                        TEXT        PRIMARY KEY,
    tenant_id                 TEXT        NOT NULL,
    name                      TEXT        NOT NULL,
    description               TEXT,
    endpoint_url              TEXT        NOT NULL CHECK (endpoint_url ~ '^https?://'),
    status                    TEXT        NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'paused', 'disabled')
    ),
    secret                    TEXT        NOT NULL CHECK (length(secret) >= 16),
    previous_secret           TEXT,
    previous_secret_expires_at TIMESTAMPTZ,
    headers                   JSONB       NOT NULL DEFAULT '{}'::JSONB,
    timeout_ms                INTEGER     NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 100 AND 60000),
    max_attempts              INTEGER     NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
    retry_override            JSONB,
    auto_disable_threshold    INTEGER     NOT NULL DEFAULT 20 CHECK (auto_disable_threshold >= 1),
    consecutive_failures      INTEGER     NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    total_deliveries          BIGINT      NOT NULL DEFAULT 0,
    total_failures            BIGINT      NOT NULL DEFAULT 0,
    last_success_at           TIMESTAMPTZ,
    last_failure_at           TIMESTAMPTZ,
    disabled_at               TIMESTAMPTZ,
    disabled_reason           TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                   INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT webhook_name_uq UNIQUE (tenant_id, name),
    CONSTRAINT webhook_rotation_is_complete CHECK (
        (previous_secret IS NULL AND previous_secret_expires_at IS NULL)
        OR (previous_secret IS NOT NULL AND previous_secret_expires_at IS NOT NULL)
    ),
    CONSTRAINT webhook_rotated_secret_differs CHECK (
        previous_secret IS NULL OR previous_secret <> secret
    ),
    CONSTRAINT webhook_disabled_has_reason CHECK (
        status <> 'disabled' OR disabled_reason IS NOT NULL
    )
);

-- Patterns are a child table so fan-out can join instead of scanning JSON.
CREATE TABLE integration.webhook_subscription_pattern (
    subscription_id TEXT NOT NULL REFERENCES integration.webhook_subscription (id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,
    pattern         integration.topic_pattern NOT NULL,
    PRIMARY KEY (subscription_id, pattern)
);

CREATE INDEX webhook_status_ix ON integration.webhook_subscription (tenant_id, status);
CREATE INDEX webhook_unhealthy_ix ON integration.webhook_subscription (tenant_id, consecutive_failures DESC)
    WHERE consecutive_failures > 0;
CREATE INDEX webhook_pattern_tenant_ix ON integration.webhook_subscription_pattern (tenant_id, pattern);

CREATE TRIGGER webhook_touch BEFORE UPDATE ON integration.webhook_subscription
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
