-- Phase 8: constrained, observable and retryable workflow automation.
-- Apply after migrations/012_phase7_completion.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  trigger_type VARCHAR(40) NOT NULL CHECK (trigger_type IN (
    'lead_created', 'deal_stage_changed', 'activity_overdue', 'invoice_overdue', 'deal_won'
  )),
  conditions JSONB NOT NULL DEFAULT '{"all":[]}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  actions JSONB NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_key VARCHAR(240) NOT NULL,
  trigger_type VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, event_key),
  UNIQUE (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  event_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'retry', 'succeeded', 'dead_letter'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error VARCHAR(1000),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, event_id),
  CONSTRAINT automation_jobs_workspace_rule_fk FOREIGN KEY (rule_id, workspace_id)
    REFERENCES automation_rules(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT automation_jobs_workspace_event_fk FOREIGN KEY (event_id, workspace_id)
    REFERENCES automation_events(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_action_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  action_index INTEGER NOT NULL CHECK (action_index >= 0 AND action_index < 10),
  action_type VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error VARCHAR(1000),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, action_index)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  request_id VARCHAR(128),
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automation_rules_workspace_trigger_idx
  ON automation_rules (workspace_id, trigger_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS automation_jobs_ready_idx
  ON automation_jobs (status, available_at, created_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS automation_jobs_workspace_status_idx
  ON automation_jobs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx
  ON audit_events (workspace_id, created_at DESC, id DESC);

INSERT INTO schema_migrations (version) VALUES ('013_phase8_automation')
ON CONFLICT (version) DO NOTHING;
COMMIT;
