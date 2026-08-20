-- Phase 7: provider-neutral communication, message delivery and calendar sync foundation.
-- Apply after migrations/008_phase5_quote_to_cash.sql.
-- Provider secrets must remain in the deployment secret store; this schema stores only
-- provider identifiers, token references and observable sync state.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS communication_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('email', 'calendar')),
  provider VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'error', 'revoked')),
  external_account_id VARCHAR(320),
  display_name VARCHAR(200),
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes) = 'array'),
  token_reference VARCHAR(500),
  token_expires_at TIMESTAMPTZ,
  sync_cursor TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error VARCHAR(1000),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_integrations_workspace_account_unique_idx
  ON communication_integrations (workspace_id, kind, provider, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
  subject VARCHAR(200) NOT NULL CHECK (length(trim(subject)) > 0),
  body_text TEXT NOT NULL CHECK (length(trim(body_text)) > 0),
  body_html TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_templates_workspace_name_unique_idx
  ON email_templates (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel VARCHAR(16) NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  provider VARCHAR(40) NOT NULL,
  provider_message_id VARCHAR(256),
  idempotency_key VARCHAR(128) NOT NULL,
  provider_idempotency_key VARCHAR(220) NOT NULL,
  retry_of_id UUID,
  template_id UUID,
  lead_id UUID,
  account_id UUID,
  contact_id UUID,
  deal_id UUID,
  from_address VARCHAR(320) NOT NULL,
  recipient VARCHAR(320) NOT NULL,
  subject VARCHAR(200) NOT NULL CHECK (length(trim(subject)) > 0),
  body_text TEXT NOT NULL CHECK (length(trim(body_text)) > 0),
  body_html TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  failure_reason VARCHAR(1000),
  attempted_by TEXT NOT NULL,
  request_id VARCHAR(128),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT outbound_messages_target_check CHECK (
    num_nonnulls(lead_id, account_id, contact_id, deal_id) = 1
  ),
  CONSTRAINT outbound_messages_workspace_template_fk FOREIGN KEY (template_id, workspace_id)
    REFERENCES email_templates(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_workspace_retry_fk FOREIGN KEY (retry_of_id, workspace_id)
    REFERENCES outbound_messages(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_workspace_lead_fk FOREIGN KEY (lead_id, workspace_id)
    REFERENCES leads(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES accounts(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_workspace_contact_fk FOREIGN KEY (contact_id, workspace_id)
    REFERENCES contacts(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
    REFERENCES deals(id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  body VARCHAR(1000),
  entity_type VARCHAR(40),
  entity_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'dismissed')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS integration_id UUID,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(40),
  ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(512),
  ADD COLUMN IF NOT EXISTS meeting_url VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(24) DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS sync_error VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_sync_status_check') THEN
    ALTER TABLE meetings ADD CONSTRAINT meetings_sync_status_check
      CHECK (sync_status IN ('local', 'pending', 'synced', 'failed', 'deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_workspace_integration_fk') THEN
    ALTER TABLE meetings ADD CONSTRAINT meetings_workspace_integration_fk
      FOREIGN KEY (integration_id, workspace_id)
      REFERENCES communication_integrations(id, workspace_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS outbound_messages_workspace_created_idx
  ON outbound_messages (workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_workspace_target_idx
  ON outbound_messages (workspace_id, deal_id, contact_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_workspace_status_idx
  ON outbound_messages (workspace_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_status_idx
  ON notifications (workspace_id, recipient_user_id, status, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS meetings_workspace_external_event_unique_idx
  ON meetings (workspace_id, provider, external_event_id)
  WHERE external_event_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('009_phase7_communications')
ON CONFLICT (version) DO NOTHING;

COMMIT;
