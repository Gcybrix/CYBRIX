-- CYBRIX migration 0002_entities — users / upstreams / relays / configs / subscriptions
-- Syncable entities (users, upstreams, relays, configs) carry version + updated_at
-- (tombstone contract, Prompt 3 §Sync). Config path XOR is a locked decision:
--   upstream_id XOR relay_id — both NULL = valid "no path" state.

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  contact              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  expires_at           INTEGER,
  traffic_limit_bytes  INTEGER,                -- NULL = unlimited (i64)
  traffic_used_bytes   INTEGER NOT NULL DEFAULT 0 CHECK (traffic_used_bytes >= 0),
  traffic_reset_day    INTEGER CHECK (traffic_reset_day IS NULL OR (traffic_reset_day BETWEEN 1 AND 28)),
  traffic_last_reset_at INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER,
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_users_updated ON users (updated_at, id);
CREATE INDEX idx_users_contact ON users (contact);

CREATE TABLE upstreams (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  host       TEXT NOT NULL,
  port       INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_upstreams_updated ON upstreams (updated_at, id);

CREATE TABLE relays (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  provider            TEXT,
  public_endpoint     TEXT,
  public_port         INTEGER CHECK (public_port IS NULL OR public_port BETWEEN 1 AND 65535),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_heartbeat_at   INTEGER,
  last_health_status  TEXT,
  agent_version       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_relays_name_live ON relays (name) WHERE deleted_at IS NULL;
CREATE INDEX idx_relays_updated ON relays (updated_at, id);

CREATE TABLE configs (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users (id),
  protocol             TEXT NOT NULL,
  upstream_id          TEXT REFERENCES upstreams (id),
  relay_id             TEXT REFERENCES relays (id),
  enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  credential_encrypted TEXT,
  credential_key_id    TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER,
  version              INTEGER NOT NULL DEFAULT 1,
  -- LOCKED (Prompt 3): at most one path; both NULL = "no path" (valid)
  CHECK (upstream_id IS NULL OR relay_id IS NULL)
);
CREATE INDEX idx_configs_user ON configs (user_id);
CREATE INDEX idx_configs_relay ON configs (relay_id);
CREATE INDEX idx_configs_updated ON configs (updated_at, id);

CREATE TABLE subscriptions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  token_hash       TEXT UNIQUE,
  token_prefix     TEXT,
  last_accessed_at INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_subs_user ON subscriptions (user_id);
