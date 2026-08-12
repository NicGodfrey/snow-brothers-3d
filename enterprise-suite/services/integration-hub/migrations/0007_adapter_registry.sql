-- integration-hub 0007: adapter registry
--
-- One row per configured adapter instance. Credentials are never stored here:
-- `credentials_ref` points into the secret store and the CHECK enforces that
-- shape, so a plaintext password cannot be pasted into the column by mistake.

CREATE TABLE integration.adapter_registration (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    name                 TEXT        NOT NULL,
    kind                 TEXT        NOT NULL CHECK (
        kind IN ('http', 'sftp', 's3', 'kafka', 'csv-file', 'email')
    ),
    direction            TEXT        NOT NULL CHECK (
        direction IN ('inbound', 'outbound', 'bidirectional')
    ),
    config               JSONB       NOT NULL DEFAULT '{}'::JSONB,
    credentials_ref      TEXT        CHECK (credentials_ref IS NULL OR credentials_ref ~ '^secret://'),
    status               TEXT        NOT NULL DEFAULT 'registered' CHECK (
        status IN ('registered', 'connected', 'degraded', 'error', 'disabled')
    ),
    supports_push        BOOLEAN     NOT NULL,
    supports_pull        BOOLEAN     NOT NULL,
    supports_batch       BOOLEAN     NOT NULL,
    max_batch_size       INTEGER     NOT NULL CHECK (max_batch_size >= 1),
    last_health_ok       BOOLEAN,
    last_health_at       TIMESTAMPTZ,
    last_health_latency_ms INTEGER,
    last_health_message  TEXT,
    consecutive_failures INTEGER     NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    messages_sent        BIGINT      NOT NULL DEFAULT 0,
    messages_pulled      BIGINT      NOT NULL DEFAULT 0,
    last_used_at         TIMESTAMPTZ,
    disabled_reason      TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    version              INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT adapter_name_uq UNIQUE (tenant_id, name),
    CONSTRAINT adapter_inbound_can_pull CHECK (direction <> 'inbound' OR supports_pull),
    CONSTRAINT adapter_outbound_can_push CHECK (direction <> 'outbound' OR supports_push),
    CONSTRAINT adapter_disabled_has_reason CHECK (
        status <> 'disabled' OR disabled_reason IS NOT NULL
    )
);

-- Cursor state for pull-based adapters (Kafka offsets, SFTP watermarks).
CREATE TABLE integration.adapter_cursor (
    adapter_id   TEXT        NOT NULL REFERENCES integration.adapter_registration (id) ON DELETE CASCADE,
    tenant_id    TEXT        NOT NULL,
    stream       TEXT        NOT NULL DEFAULT 'default',
    cursor_value TEXT        NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (adapter_id, stream)
);

CREATE INDEX adapter_kind_ix ON integration.adapter_registration (tenant_id, kind);
CREATE INDEX adapter_status_ix ON integration.adapter_registration (tenant_id, status);
CREATE INDEX adapter_unhealthy_ix ON integration.adapter_registration (tenant_id, last_health_at DESC)
    WHERE status IN ('degraded', 'error');

CREATE TRIGGER adapter_touch BEFORE UPDATE ON integration.adapter_registration
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
