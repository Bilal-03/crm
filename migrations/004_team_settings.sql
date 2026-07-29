-- Adds member contact data and pending email invitations for shared workspaces.
-- Apply only after migrations/003_workspace_foundation.sql.

BEGIN;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS email VARCHAR(320);

CREATE TABLE workspace_invitations (
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

CREATE UNIQUE INDEX workspace_invitations_pending_email_unique_idx
  ON workspace_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id, workspace_id);
CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (lower(email), expires_at);

COMMIT;
