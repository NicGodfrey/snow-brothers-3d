-- Operational history: probe results, spec aggregation runs and throttling.
-- All three are written by the gateway and read by dashboards; none of them
-- sit on the request path.

CREATE TABLE IF NOT EXISTS gateway_probe_result (
  id           BIGSERIAL PRIMARY KEY,
  service_id   TEXT        NOT NULL,
  kind         TEXT        NOT NULL CHECK (kind IN ('health', 'ready')),
  status       TEXT        NOT NULL CHECK (status IN ('up', 'degraded', 'down', 'unknown')),
  latency_ms   INTEGER     NOT NULL,
  detail       TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gateway_probe_service_time_idx
  ON gateway_probe_result (service_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS gateway_openapi_run (
  id              BIGSERIAL PRIMARY KEY,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  path_count      INTEGER     NOT NULL,
  operation_count INTEGER     NOT NULL,
  upstream_count  INTEGER     NOT NULL,
  stub_count      INTEGER     NOT NULL,
  failed_count    INTEGER     NOT NULL,
  warnings        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  document_sha256 TEXT        NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_rate_limit_window (
  bucket_key   TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 0,
  limit_value  INTEGER     NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

-- Windows are disposable; keep a day for forensics and let a job prune them.
CREATE INDEX IF NOT EXISTS gateway_rate_limit_window_start_idx
  ON gateway_rate_limit_window (window_start);
