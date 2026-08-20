-- Phase 6 completion: goals, quotas, pacing and forecast-versus-target reporting.
-- Apply after migrations/009_phase7_communications.sql because that migration may
-- already be present on installations that started the first Phase 7 increment.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('team', 'owner')),
  owner_user_id TEXT,
  metric VARCHAR(32) NOT NULL CHECK (metric IN ('won_revenue', 'collected_revenue', 'deals_won')),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  target_value NUMERIC(14, 2) NOT NULL CHECK (target_value > 0),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_goals_period_check CHECK (period_end >= period_start),
  CONSTRAINT sales_goals_scope_owner_check CHECK (
    (scope = 'team' AND owner_user_id IS NULL)
    OR (scope = 'owner' AND owner_user_id IS NOT NULL)
  ),
  CONSTRAINT sales_goals_workspace_owner_fk FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_members(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_goals_active_quota_unique_idx
  ON sales_goals (
    workspace_id, metric, currency, period_start, period_end,
    COALESCE(owner_user_id, '__team__')
  ) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS sales_goals_workspace_period_idx
  ON sales_goals (workspace_id, period_start, period_end, status, id);
CREATE INDEX IF NOT EXISTS sales_goals_workspace_owner_idx
  ON sales_goals (workspace_id, owner_user_id, status, period_end DESC, id DESC);

INSERT INTO schema_migrations (version) VALUES ('010_phase6_goals_quotas')
ON CONFLICT (version) DO NOTHING;

COMMIT;
