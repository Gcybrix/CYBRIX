-- CYBRIX migration 0003_usage — relay_tokens / usage_reports / usage_daily
-- Exactly ONE active relay token per relay (partial unique — Prompt 3).
-- Usage idempotency: UNIQUE(relay_id, report_id).

CREATE TABLE relay_tokens (
  id           TEXT PRIMARY KEY,
  relay_id     TEXT NOT NULL REFERENCES relays (id),
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  issued_by    TEXT,
  expires_at   INTEGER,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE UNIQUE INDEX idx_relay_tokens_one_active
  ON relay_tokens (relay_id) WHERE status = 'active';
CREATE INDEX idx_relay_tokens_relay ON relay_tokens (relay_id);

CREATE TABLE usage_reports (
  id              TEXT PRIMARY KEY,
  relay_id        TEXT NOT NULL,
  report_id       TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  entries_json    TEXT NOT NULL CHECK (json_valid(entries_json)),
  entry_count     INTEGER NOT NULL CHECK (entry_count >= 1),
  bytes_up_total  INTEGER NOT NULL DEFAULT 0,
  bytes_down_total INTEGER NOT NULL DEFAULT 0,
  generated_at    INTEGER NOT NULL,
  ingested_at     INTEGER NOT NULL,
  UNIQUE (relay_id, report_id)
);
CREATE INDEX idx_usage_reports_relay_time ON usage_reports (relay_id, ingested_at);

-- Derived aggregation table (physical deletes allowed per Prompt 3)
CREATE TABLE usage_daily (
  day         TEXT NOT NULL,          -- YYYY-MM-DD (UTC, from ingested_at)
  relay_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  config_id   TEXT NOT NULL,
  bytes_up    INTEGER NOT NULL DEFAULT 0,
  bytes_down  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, relay_id, user_id, config_id)
);
CREATE INDEX idx_usage_daily_day ON usage_daily (day);
CREATE INDEX idx_usage_daily_user ON usage_daily (user_id);
