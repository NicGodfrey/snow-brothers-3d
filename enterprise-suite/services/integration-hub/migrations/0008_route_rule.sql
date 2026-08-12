-- integration-hub 0008: routing rules
--
-- The wiring table: which events go to which destination, optionally filtered
-- and reshaped. Exactly one destination column is populated, enforced by a
-- CHECK rather than by application code.

CREATE TABLE integration.route_rule (
    id               TEXT        PRIMARY KEY,
    tenant_id        TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    description      TEXT,
    destination_type TEXT        NOT NULL CHECK (destination_type IN ('webhook', 'adapter', 'bus')),
    subscription_id  TEXT        REFERENCES integration.webhook_subscription (id) ON DELETE CASCADE,
    adapter_id       TEXT        REFERENCES integration.adapter_registration (id) ON DELETE CASCADE,
    bus_topic        integration.event_type,
    filter_expression JSONB,
    transform_spec   JSONB,
    enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
    priority         INTEGER     NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    match_count      BIGINT      NOT NULL DEFAULT 0,
    last_matched_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version          INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT route_name_uq UNIQUE (tenant_id, name),
    CONSTRAINT route_exactly_one_destination CHECK (
        (destination_type = 'webhook' AND subscription_id IS NOT NULL AND adapter_id IS NULL AND bus_topic IS NULL)
        OR (destination_type = 'adapter' AND adapter_id IS NOT NULL AND subscription_id IS NULL AND bus_topic IS NULL)
        OR (destination_type = 'bus' AND bus_topic IS NOT NULL AND subscription_id IS NULL AND adapter_id IS NULL)
    )
);

CREATE TABLE integration.route_rule_pattern (
    rule_id   TEXT NOT NULL REFERENCES integration.route_rule (id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    pattern   integration.topic_pattern NOT NULL,
    PRIMARY KEY (rule_id, pattern)
);

-- Evaluation order: highest priority first.
CREATE INDEX route_enabled_ix ON integration.route_rule (tenant_id, priority DESC)
    WHERE enabled;
CREATE INDEX route_destination_ix ON integration.route_rule (tenant_id, destination_type);
CREATE INDEX route_pattern_ix ON integration.route_rule_pattern (tenant_id, pattern);

CREATE TRIGGER route_touch BEFORE UPDATE ON integration.route_rule
    FOR EACH ROW EXECUTE FUNCTION integration.touch_row();
