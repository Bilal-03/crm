-- Phase 0: canonical migration tracking and trustworthy period boundaries.
-- Apply after migrations/002_production_hardening.sql through 004_team_settings.sql.
-- Take a database snapshot before applying this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;

-- Existing records do not have a historical stage-event timestamp. updated_at is
-- the safest available backfill; new stage changes are timestamped by the API.
UPDATE leads
SET won_at = COALESCE(won_at, updated_at)
WHERE stage = 'closed-won' AND won_at IS NULL;

UPDATE leads
SET lost_at = COALESCE(lost_at, updated_at)
WHERE stage = 'closed-lost' AND lost_at IS NULL;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS email VARCHAR(320);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id, workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_email_unique_idx
  ON workspace_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_invitations_email_idx ON workspace_invitations (lower(email), expires_at);
CREATE INDEX IF NOT EXISTS leads_workspace_won_idx ON leads (workspace_id, won_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS leads_workspace_lost_idx ON leads (workspace_id, lost_at DESC, id DESC);

INSERT INTO schema_migrations (version) VALUES
  ('002_production_hardening'),
  ('003_workspace_foundation'),
  ('004_team_settings'),
  ('005_phase0_data_correctness')
ON CONFLICT (version) DO NOTHING;

COMMIT;
