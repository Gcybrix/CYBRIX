-- CYBRIX migration 0004_audit — append-only audit_logs

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin','bot','relay','subscription','system')),
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  request_id  TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC, id DESC);
CREATE INDEX idx_audit_action ON audit_logs (action);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
