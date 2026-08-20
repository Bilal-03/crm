-- Phase 7: Google Calendar OAuth, encrypted credentials and idempotent event sync.
-- Apply after migrations/010_phase6_goals_quotas.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE communication_integrations
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
  ADD COLUMN IF NOT EXISTS calendar_id VARCHAR(512) DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE communication_integrations SET owner_user_id = created_by WHERE owner_user_id IS NULL;
ALTER TABLE communication_integrations ALTER COLUMN owner_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communication_integrations_workspace_owner_fk') THEN
    ALTER TABLE communication_integrations ADD CONSTRAINT communication_integrations_workspace_owner_fk
      FOREIGN KEY (workspace_id, owner_user_id)
      REFERENCES workspace_members(workspace_id, user_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS communication_integrations_workspace_owner_provider_unique_idx
  ON communication_integrations (workspace_id, owner_user_id, kind, provider);

CREATE TABLE IF NOT EXISTS integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_type VARCHAR(32) NOT NULL DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_credentials_workspace_integration_fk FOREIGN KEY (integration_id, workspace_id)
    REFERENCES communication_integrations(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (integration_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS integration_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  state_hash CHAR(64) NOT NULL UNIQUE,
  return_path VARCHAR(500) NOT NULL DEFAULT '/communications',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_oauth_states_workspace_user_fk FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_end_after_start_check') THEN
    ALTER TABLE meetings ADD CONSTRAINT meetings_end_after_start_check
      CHECK (end_time IS NULL OR end_time > date_time);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS integration_oauth_states_expiry_idx
  ON integration_oauth_states (provider, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS integration_credentials_workspace_idx
  ON integration_credentials (workspace_id, integration_id);

INSERT INTO schema_migrations (version) VALUES ('011_phase7_google_calendar')
ON CONFLICT (version) DO NOTHING;

COMMIT;
