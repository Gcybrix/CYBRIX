-- CYBRIX migration 0005_triggers — version bumps (sync/tombstone) + append-only guards
-- Prompt 3 requirement: recursive_triggers=OFF respected (D1 default). The WHEN
-- guards make these triggers safe even if recursive triggers were ever enabled.
--
-- Version-bump policy: business mutations bump version + updated_at (cursor moves).
-- Heartbeat bookkeeping columns (relays.last_heartbeat_at/last_health_status/
-- agent_version) and usage accounting (users.traffic_used_bytes) intentionally do
-- NOT bump version — they are not registry state (documented in the contract notes).

-- ---- version bump: users ----
CREATE TRIGGER trg_users_bump
AFTER UPDATE OF contact, status, expires_at, traffic_limit_bytes,
                traffic_reset_day, traffic_last_reset_at, deleted_at ON users
WHEN NEW.version = OLD.version
BEGIN
  UPDATE users
     SET version = OLD.version + 1,
         updated_at = strftime('%s','now')
   WHERE id = NEW.id;
END;

-- ---- version bump: upstreams ----
CREATE TRIGGER trg_upstreams_bump
AFTER UPDATE OF type, host, port, status, deleted_at ON upstreams
WHEN NEW.version = OLD.version
BEGIN
  UPDATE upstreams
     SET version = OLD.version + 1,
         updated_at = strftime('%s','now')
   WHERE id = NEW.id;
END;

-- ---- version bump: relays (registry fields only) ----
CREATE TRIGGER trg_relays_bump
AFTER UPDATE OF name, provider, public_endpoint, public_port, status, deleted_at ON relays
WHEN NEW.version = OLD.version
BEGIN
  UPDATE relays
     SET version = OLD.version + 1,
         updated_at = strftime('%s','now')
   WHERE id = NEW.id;
END;

-- ---- version bump: configs ----
CREATE TRIGGER trg_configs_bump
AFTER UPDATE OF user_id, protocol, upstream_id, relay_id, enabled,
                credential_encrypted, credential_key_id, deleted_at ON configs
WHEN NEW.version = OLD.version
BEGIN
  UPDATE configs
     SET version = OLD.version + 1,
         updated_at = strftime('%s','now')
   WHERE id = NEW.id;
END;

-- ---- append-only: audit_logs ----
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'append_only_violation: audit_logs');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'append_only_violation: audit_logs');
END;

-- ---- append-only: usage_reports ----
CREATE TRIGGER trg_usage_reports_no_update
BEFORE UPDATE ON usage_reports
BEGIN
  SELECT RAISE(ABORT, 'append_only_violation: usage_reports');
END;

CREATE TRIGGER trg_usage_reports_no_delete
BEFORE DELETE ON usage_reports
BEGIN
  SELECT RAISE(ABORT, 'append_only_violation: usage_reports');
END;

-- ---- no physical delete of business entities (soft deletion only, Prompt 3) ----
CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users
BEGIN SELECT RAISE(ABORT, 'soft_delete_only: users'); END;
CREATE TRIGGER trg_upstreams_no_delete BEFORE DELETE ON upstreams
BEGIN SELECT RAISE(ABORT, 'soft_delete_only: upstreams'); END;
CREATE TRIGGER trg_relays_no_delete BEFORE DELETE ON relays
BEGIN SELECT RAISE(ABORT, 'soft_delete_only: relays'); END;
CREATE TRIGGER trg_configs_no_delete BEFORE DELETE ON configs
BEGIN SELECT RAISE(ABORT, 'soft_delete_only: configs'); END;
CREATE TRIGGER trg_subscriptions_no_delete BEFORE DELETE ON subscriptions
BEGIN SELECT RAISE(ABORT, 'soft_delete_only: subscriptions'); END;
CREATE TRIGGER trg_tg_admins_no_delete BEFORE DELETE ON telegram_admins
BEGIN SELECT RAISE(ABORT, 'soft_delete_only: telegram_admins'); END;
