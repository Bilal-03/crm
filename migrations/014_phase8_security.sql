-- Phase 8 security controls: durable API throttling counters.
-- Apply after migrations/013_phase8_automation.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_rate_limit_counters (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject VARCHAR(256) NOT NULL,
  scope VARCHAR(80) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1 CHECK (hit_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, subject, scope, window_started_at)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_expiry_idx ON api_rate_limit_counters (expires_at);

INSERT INTO schema_migrations (version) VALUES ('014_phase8_security')
ON CONFLICT (version) DO NOTHING;
COMMIT;
