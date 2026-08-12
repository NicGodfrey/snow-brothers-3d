-- integration-hub 0004: idempotency keys
--
-- One row per (tenant, scope, key). `request_fingerprint` is a SHA-256 over
-- the canonicalized request body: a retry with the same fingerprint replays
-- the stored response, a different one is a client bug and is rejected.
-- Rows are disposable — `expires_at` bounds how long a response is replayable.

CREATE TABLE integration.idempotency_record (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    scope                TEXT        NOT NULL,
    key                  TEXT        NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
    request_fingerprint  TEXT        NOT NULL CHECK (length(request_fingerprint) = 64),
    status               TEXT        NOT NULL DEFAULT 'in-progress' CHECK (
        status IN ('in-progress', 'completed', 'failed')
    ),
    response_status      INTEGER     CHECK (response_status BETWEEN 100 AND 599),
    response_body        JSONB,
    error                TEXT,
    reserved_at          TIMESTAMPTZ NOT NULL,
    completed_at         TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ NOT NULL,
    request_count        INTEGER     NOT NULL DEFAULT 1 CHECK (request_count >= 1),
    replay_count         INTEGER     NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    version              INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT idempotency_key_uq UNIQUE (tenant_id, scope, key),
    CONSTRAINT idempotency_completed_has_response CHECK (
        status <> 'completed' OR response_status IS NOT NULL
    ),
    CONSTRAINT idempotency_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL),
    CONSTRAINT idempotency_expiry_after_reservation CHECK (expires_at > reserved_at)
);

-- Housekeeping job: delete rows past their TTL.
CREATE INDEX idempotency_expiry_ix ON integration.idempotency_record (expires_at);
CREATE INDEX idempotency_scope_ix ON integration.idempotency_record (tenant_id, scope, reserved_at DESC);
-- Detecting stuck reservations (a crashed request holding a key).
CREATE INDEX idempotency_in_progress_ix ON integration.idempotency_record (reserved_at)
    WHERE status = 'in-progress';

CREATE TRIGGER idempotency_touch BEFORE UPDATE ON integration.idempotency_record
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
