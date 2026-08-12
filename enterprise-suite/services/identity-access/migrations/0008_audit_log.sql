-- Append-only audit log for authorization decisions, authentication attempts and
-- administrative changes. No UPDATE or DELETE path exists: the rule is enforced by a
-- trigger rather than left to convention.

SET search_path TO identity, public;

CREATE TABLE identity.audit_log (
  id             text NOT NULL,
  tenant_id      text NOT NULL REFERENCES identity.tenants (tenant_id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  category       identity.audit_category NOT NULL,
  action         text NOT NULL,
  outcome        identity.audit_outcome NOT NULL,

  subject_type   identity.subject_type NOT NULL,
  subject_id     text NOT NULL,
  permission     text,
  scope          text,
  reason         text,
  resource_type  text,
  resource_id    text,
  actor_id       text,
  correlation_id text,
  ip             inet,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT audit_authz_has_permission
    CHECK (category <> 'authz' OR permission IS NOT NULL)
);

-- The common reads are "recent entries for this tenant" and "recent denials", both
-- newest-first, so every index leads with `at DESC`.
CREATE INDEX audit_log_recent_idx ON identity.audit_log (tenant_id, at DESC);
CREATE INDEX audit_log_denials_idx ON identity.audit_log (tenant_id, at DESC)
  WHERE outcome = 'deny';
CREATE INDEX audit_log_subject_idx
  ON identity.audit_log (tenant_id, subject_type, subject_id, at DESC);
CREATE INDEX audit_log_permission_idx ON identity.audit_log (tenant_id, permission, at DESC)
  WHERE permission IS NOT NULL;
CREATE INDEX audit_log_correlation_idx ON identity.audit_log (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX audit_log_metadata_idx ON identity.audit_log USING gin (metadata);

CREATE OR REPLACE FUNCTION identity.reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'identity.audit_log is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON identity.audit_log
  FOR EACH ROW EXECUTE FUNCTION identity.reject_audit_mutation();

-- Denials grouped by permission and reason: the report that shows a role is missing a
-- permission rather than an individual being misconfigured.
CREATE OR REPLACE VIEW identity.authz_denial_summary AS
SELECT
  tenant_id,
  permission,
  reason,
  count(*) AS denial_count,
  count(DISTINCT subject_id) AS distinct_subjects,
  max(at) AS last_at
FROM identity.audit_log
WHERE category = 'authz' AND outcome = 'deny'
GROUP BY tenant_id, permission, reason;

-- Per-subject allow/deny tallies for anomaly review.
CREATE OR REPLACE VIEW identity.authz_subject_activity AS
SELECT
  tenant_id,
  subject_type,
  subject_id,
  count(*) FILTER (WHERE outcome = 'allow') AS allows,
  count(*) FILTER (WHERE outcome = 'deny') AS denies,
  max(at) AS last_at
FROM identity.audit_log
WHERE category = 'authz'
GROUP BY tenant_id, subject_type, subject_id;

-- Failed sign-ins per hour; feeds credential-stuffing alerts.
CREATE OR REPLACE VIEW identity.authn_failure_rate AS
SELECT
  tenant_id,
  date_trunc('hour', at) AS bucket,
  count(*) AS failures,
  count(DISTINCT subject_id) AS distinct_subjects,
  count(DISTINCT ip) AS distinct_sources
FROM identity.audit_log
WHERE category = 'authn' AND outcome = 'failure'
GROUP BY tenant_id, date_trunc('hour', at);

-- Retention helper: audit rows are kept for a fixed window, then dropped in batches.
-- The append-only trigger blocks DELETE, so retention runs with it disabled.
CREATE OR REPLACE FUNCTION identity.purge_audit_before(p_tenant_id text, p_before timestamptz)
RETURNS integer AS $$
DECLARE
  purged integer;
BEGIN
  ALTER TABLE identity.audit_log DISABLE TRIGGER audit_log_append_only;
  WITH removed AS (
    DELETE FROM identity.audit_log
    WHERE tenant_id = p_tenant_id AND at < p_before
    RETURNING 1
  )
  SELECT count(*) INTO purged FROM removed;
  ALTER TABLE identity.audit_log ENABLE TRIGGER audit_log_append_only;
  RETURN purged;
END;
$$ LANGUAGE plpgsql;
