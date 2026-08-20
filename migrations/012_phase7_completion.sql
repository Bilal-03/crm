-- Phase 7 completion: durable notification deduplication, mentions, and
-- communication timeline provenance. Apply after 011_phase7_google_calendar.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(240),
  ADD COLUMN IF NOT EXISTS action_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_workspace_recipient_dedupe_idx
  ON notifications (workspace_id, recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS activities_workspace_source_idx
  ON activities (workspace_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_workspace_entity_idx
  ON notifications (workspace_id, entity_type, entity_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('012_phase7_completion')
ON CONFLICT (version) DO NOTHING;

COMMIT;
