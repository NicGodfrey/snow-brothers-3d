-- Transactional outbox and the platform-wide seed data every tenant starts from.

SET search_path TO identity, public;

-- Domain events are written in the same transaction as the state change that produced
-- them; a relay publishes and marks them, so a crash between the two is a retry rather
-- than a lost event.
CREATE TABLE identity.outbox (
  event_id       text PRIMARY KEY,
  tenant_id      text NOT NULL,
  event_type     text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  payload        jsonb NOT NULL,
  correlation_id text,
  causation_id   text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text
);

-- The relay polls exactly this predicate, so the index is partial and stays small.
CREATE INDEX outbox_unpublished_idx ON identity.outbox (occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX outbox_aggregate_idx ON identity.outbox (tenant_id, aggregate_type, aggregate_id);
CREATE INDEX outbox_type_idx ON identity.outbox (event_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION identity.claim_outbox_batch(p_limit integer DEFAULT 100)
RETURNS SETOF identity.outbox AS $$
BEGIN
  RETURN QUERY
  UPDATE identity.outbox o
  SET attempts = o.attempts + 1
  WHERE o.event_id IN (
    SELECT event_id FROM identity.outbox
    WHERE published_at IS NULL
    ORDER BY occurred_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING o.*;
END;
$$ LANGUAGE plpgsql;

-- Permission catalog. Mirrors src/infrastructure/bootstrap/system-permissions.ts; the
-- application re-registers on boot, so this seed only makes a fresh database useful
-- before the first process starts.
INSERT INTO identity.permissions (key, resource, action, description, category, scopable, dangerous)
VALUES
  ('identity.tenant:read',            'identity.tenant',      'read',            'View tenant profile and settings', 'Identity & Access', false, false),
  ('identity.tenant:update',          'identity.tenant',      'update',          'Change tenant name and settings', 'Identity & Access', false, false),
  ('identity.tenant:suspend',         'identity.tenant',      'suspend',         'Suspend or archive the tenant', 'Identity & Access', false, true),
  ('identity.user:read',              'identity.user',        'read',            'View users', 'Identity & Access', true, false),
  ('identity.user:invite',            'identity.user',        'invite',          'Invite new users', 'Identity & Access', true, false),
  ('identity.user:update',            'identity.user',        'update',          'Change a user profile, email or attributes', 'Identity & Access', true, false),
  ('identity.user:suspend',           'identity.user',        'suspend',         'Suspend or reactivate a user', 'Identity & Access', true, false),
  ('identity.user:deactivate',        'identity.user',        'deactivate',      'Permanently deactivate a user', 'Identity & Access', true, true),
  ('identity.user:reset_password',    'identity.user',        'reset_password',  'Set a password on behalf of a user', 'Identity & Access', true, true),
  ('identity.user:unlock',            'identity.user',        'unlock',          'Clear a lockout after failed sign-ins', 'Identity & Access', true, false),
  ('identity.user:impersonate',       'identity.user',        'impersonate',     'Sign in as another user', 'Identity & Access', true, true),
  ('identity.user:manage_mfa',        'identity.user',        'manage_mfa',      'Enroll or remove a second factor', 'Identity & Access', true, false),
  ('identity.group:read',             'identity.group',       'read',            'View groups and their membership', 'Identity & Access', true, false),
  ('identity.group:create',           'identity.group',       'create',          'Create groups', 'Identity & Access', true, false),
  ('identity.group:update',           'identity.group',       'update',          'Rename groups and change their parent', 'Identity & Access', true, false),
  ('identity.group:manage_members',   'identity.group',       'manage_members',  'Add or remove group members', 'Identity & Access', true, false),
  ('identity.group:delete',           'identity.group',       'delete',          'Delete a group', 'Identity & Access', true, true),
  ('identity.role:read',              'identity.role',        'read',            'View roles and their grants', 'Identity & Access', true, false),
  ('identity.role:create',            'identity.role',        'create',          'Create roles', 'Identity & Access', true, false),
  ('identity.role:update',            'identity.role',        'update',          'Change a role grants or inheritance', 'Identity & Access', true, true),
  ('identity.role:delete',            'identity.role',        'delete',          'Delete a role', 'Identity & Access', true, true),
  ('identity.permission:read',        'identity.permission',  'read',            'Browse the permission catalog', 'Identity & Access', false, false),
  ('identity.role_binding:read',      'identity.role_binding','read',            'View who holds which role', 'Identity & Access', true, false),
  ('identity.role_binding:grant',     'identity.role_binding','grant',           'Bind a role to a subject', 'Identity & Access', true, true),
  ('identity.role_binding:revoke',    'identity.role_binding','revoke',          'Revoke a role binding', 'Identity & Access', true, false),
  ('identity.role_binding:delegate',  'identity.role_binding','delegate',        'Pass on a delegable role at a narrower scope', 'Identity & Access', true, false),
  ('identity.api_key:read',           'identity.api_key',     'read',            'List API keys and their metadata', 'Identity & Access', true, false),
  ('identity.api_key:issue',          'identity.api_key',     'issue',           'Issue a new API key', 'Identity & Access', true, true),
  ('identity.api_key:rotate',         'identity.api_key',     'rotate',          'Rotate an API key secret', 'Identity & Access', true, true),
  ('identity.api_key:revoke',         'identity.api_key',     'revoke',          'Revoke an API key', 'Identity & Access', true, false),
  ('identity.session:read',           'identity.session',     'read',            'List active sessions', 'Identity & Access', true, false),
  ('identity.session:revoke',         'identity.session',     'revoke',          'Sign a user out of one or all sessions', 'Identity & Access', true, false),
  ('identity.audit:read',             'identity.audit',       'read',            'Read the authorization and administrative audit log', 'Identity & Access', true, false),
  ('identity.audit:export',           'identity.audit',       'export',          'Export the audit log to an external system', 'Identity & Access', true, false),
  ('identity.authz:check',            'identity.authz',       'check',           'Ask for a decision on another subject behalf', 'Identity & Access', false, false),
  ('identity.authz:explain',          'identity.authz',       'explain',         'See why a decision was made', 'Identity & Access', true, false),
  ('platform.report:read',            'platform.report',      'read',            'View reports and dashboards', 'Platform', true, false),
  ('platform.report:export',          'platform.report',      'export',          'Export report data', 'Platform', true, false),
  ('sales.order:read',                'sales.order',          'read',            'View sales orders', 'Sales', true, false),
  ('sales.order:create',              'sales.order',          'create',          'Create sales orders', 'Sales', true, false),
  ('sales.order:approve',             'sales.order',          'approve',         'Approve sales orders above the automatic threshold', 'Sales', true, true),
  ('procurement.purchase_order:read', 'procurement.purchase_order', 'read',      'View purchase orders', 'Procurement', true, false),
  ('procurement.purchase_order:approve','procurement.purchase_order','approve',  'Approve purchase orders', 'Procurement', true, true),
  ('srm.supplier:read',               'srm.supplier',         'read',            'View supplier master data', 'Supplier Relationship', true, false),
  ('srm.supplier:update',             'srm.supplier',         'update',          'Maintain supplier master data', 'Supplier Relationship', true, false),
  ('prm.partner:read',                'prm.partner',          'read',            'View partner records', 'Partner Relationship', true, false),
  ('prm.deal_registration:approve',   'prm.deal_registration','approve',         'Approve partner deal registrations', 'Partner Relationship', true, false)
ON CONFLICT (key) DO NOTHING;

-- Installs the system role set into a tenant. Called once at provisioning; safe to
-- re-run after an upgrade adds a role.
CREATE OR REPLACE FUNCTION identity.install_system_roles(p_tenant_id text)
RETURNS integer AS $$
DECLARE
  template record;
  installed integer := 0;
  new_role_id text;
BEGIN
  FOR template IN
    SELECT * FROM (VALUES
      ('platform_owner',     'Platform Owner',           'Unrestricted access, including tenant lifecycle', true),
      ('base_reader',        'Base Reader',              'Read-only building block inherited by most roles', false),
      ('tenant_admin',       'Tenant Administrator',     'Full administration of a tenant, excluding suspension', true),
      ('security_admin',     'Security Administrator',   'Owns roles, bindings, keys and the audit trail', true),
      ('user_manager',       'User Manager',             'Day-to-day user and group administration', true),
      ('auditor',            'Auditor',                  'Read-only access to configuration and the audit log', true),
      ('integration_client', 'Integration Client',       'Intended for API keys: read access plus checks', true),
      ('member',             'Member',                   'Baseline role for ordinary users', true)
    ) AS t(code, name, description, assignable)
  LOOP
    IF EXISTS (
      SELECT 1 FROM identity.roles r
      WHERE r.tenant_id = p_tenant_id AND r.code = template.code
    ) THEN
      CONTINUE;
    END IF;
    new_role_id := 'rol_' || p_tenant_id || '_' || template.code;
    INSERT INTO identity.roles (id, tenant_id, code, name, description, is_system, is_assignable)
    VALUES (new_role_id, p_tenant_id, template.code, template.name, template.description,
            true, template.assignable);
    installed := installed + 1;
  END LOOP;

  PERFORM identity.bump_policy_version(p_tenant_id);
  RETURN installed;
END;
$$ LANGUAGE plpgsql;
