-- reporting-bi 0009: export jobs, artifacts and the outbox
--
-- An export is a job, not a download: "every invoice fact this year" is
-- unbounded work that must not hold an HTTP connection open, and the result
-- has to stay retrievable and checksummed afterwards.

CREATE TABLE reporting.export_job (
    id            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    job_number    TEXT        NOT NULL,
    format        TEXT        NOT NULL CHECK (format IN ('csv', 'ndjson')),
    kind          TEXT        NOT NULL CHECK (
        kind IN ('cube-query', 'kpi-scorecard', 'fact-dump')
    ),
    -- The full request, stored so a job can be re-run long after the session
    -- that asked for it is gone.
    request       JSONB       NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ),
    requested_by  TEXT        NOT NULL,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    attempts      INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
    row_count     BIGINT      CHECK (row_count IS NULL OR row_count >= 0),
    byte_size     BIGINT      CHECK (byte_size IS NULL OR byte_size >= 0),
    checksum      TEXT,
    artifact_key  TEXT,
    expires_at    TIMESTAMPTZ,
    error_code    TEXT,
    error_message TEXT,
    cancel_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT export_job_number_uq UNIQUE (tenant_id, job_number),
    CONSTRAINT export_completed_has_artifact CHECK (
        status <> 'completed'
        OR (artifact_key IS NOT NULL AND checksum IS NOT NULL AND row_count IS NOT NULL)
    ),
    CONSTRAINT export_failed_has_error CHECK (
        status <> 'failed' OR (error_code IS NOT NULL AND error_message IS NOT NULL)
    ),
    CONSTRAINT export_cancelled_has_reason CHECK (
        status <> 'cancelled' OR cancel_reason IS NOT NULL
    ),
    CONSTRAINT export_terminal_has_finish CHECK (
        status NOT IN ('completed', 'failed', 'cancelled') OR finished_at IS NOT NULL
    )
);

CREATE TRIGGER export_job_touch BEFORE UPDATE ON reporting.export_job
    FOR EACH ROW EXECUTE FUNCTION reporting.touch_row();

-- The worker's poll: oldest queued job first.
CREATE INDEX export_job_queue_ix
    ON reporting.export_job (tenant_id, requested_at)
    WHERE status = 'queued';
CREATE INDEX export_job_recent_ix
    ON reporting.export_job (tenant_id, requested_at DESC);
-- The retention sweep.
CREATE INDEX export_job_expiring_ix
    ON reporting.export_job (expires_at)
    WHERE status = 'completed' AND expires_at IS NOT NULL;

-- Artifact bytes. A deployment backed by object storage keeps the metadata
-- here and drops `content`, which is why nothing but the download path reads
-- that column.
CREATE TABLE reporting.export_artifact (
    tenant_id    TEXT        NOT NULL,
    key          TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    content      TEXT,
    byte_size    BIGINT      NOT NULL CHECK (byte_size >= 0),
    checksum     TEXT        NOT NULL,
    stored_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, key)
);

CREATE INDEX export_artifact_expiry_ix
    ON reporting.export_artifact (expires_at)
    WHERE expires_at IS NOT NULL;

-- Transactional outbox. Reporting is mostly a consumer of events, but it
-- publishes catalog changes, KPI threshold breaches and export lifecycle —
-- and those must commit atomically with the state that produced them, or an
-- alert fires for a snapshot that was rolled back.
CREATE TABLE reporting.outbox_event (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    event_id       TEXT        NOT NULL,
    event_type     reporting.event_type NOT NULL,
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL,
    schema_version INTEGER     NOT NULL DEFAULT 1,
    payload        JSONB       NOT NULL,
    correlation_id TEXT,
    published_at   TIMESTAMPTZ,
    attempts       INTEGER     NOT NULL DEFAULT 0,
    last_error     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT outbox_event_uq UNIQUE (tenant_id, event_id)
);

CREATE INDEX outbox_unpublished_ix
    ON reporting.outbox_event (created_at)
    WHERE published_at IS NULL;
CREATE INDEX outbox_event_type_ix
    ON reporting.outbox_event (tenant_id, event_type, occurred_at DESC);
