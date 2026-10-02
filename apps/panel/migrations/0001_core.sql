-- CYBRIX migration 0001_core — settings / admins / telegram_admins / api_clients
-- Prompt 3 conventions: UUIDv4 TEXT ids · INTEGER epoch-seconds timestamps ·
-- booleans 0/1 · JSON TEXT + json_valid · closed enums via CHECK.

CREATE TABLE settings (key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_admins_username ON admins (username);

CREATE TABLE telegram_admins (
  id               TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  username         TEXT,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  added_by         TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_tg_admins_uid_live
  ON telegram_admins (telegram_user_id) WHERE deleted_at IS NULL;

CREATE TABLE api_clients (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  scopes       TEXT NOT NULL CHECK (json_valid(scopes)),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  token_hash   TEXT UNIQUE,
  token_prefix TEXT,
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_api_clients_name_live ON api_clients (name) WHERE deleted_at IS NULL;

-- Seed: traffic_reset_default_day = 1 (Prompt 4 §10.2.1 / §10.13)
INSERT INTO settings (key, value, updated_at)
VALUES ('traffic_reset_default_day', '1', strftime('%s','now'));
