-- Phase 2: normalized CRM core model.
-- Apply after migrations/002_production_hardening.sql through
-- migrations/005_phase0_data_correctness.sql.
-- Take a database snapshot before applying this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspaces_base_currency_format_check'
      AND conrelid = 'workspaces'::regclass
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_base_currency_format_check
      CHECK (base_currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS normalized_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(40);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS normalized_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(40);

UPDATE leads
SET
  normalized_email = lower(trim(email)),
  normalized_phone = NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g'), '');

UPDATE customers
SET
  normalized_email = lower(trim(email)),
  normalized_phone = NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g'), '');

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  name VARCHAR(200) NOT NULL CHECK (length(trim(name)) > 0),
  normalized_name VARCHAR(200) NOT NULL,
  domain VARCHAR(255),
  normalized_domain VARCHAR(255),
  phone VARCHAR(40),
  normalized_phone VARCHAR(40),
  website VARCHAR(500),
  industry VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id UUID,
  owner_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  name VARCHAR(200) NOT NULL CHECK (length(trim(name)) > 0),
  title VARCHAR(160),
  email VARCHAR(320),
  normalized_email VARCHAR(320),
  phone VARCHAR(40),
  normalized_phone VARCHAR(40),
  source_lead_id UUID,
  source_customer_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  CONSTRAINT contacts_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES accounts (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT contacts_workspace_lead_fk FOREIGN KEY (source_lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT contacts_workspace_customer_fk FOREIGN KEY (source_customer_id, workspace_id)
    REFERENCES customers (id, workspace_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL,
  key VARCHAR(64) NOT NULL CHECK (length(trim(key)) > 0),
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  probability NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  color VARCHAR(16) NOT NULL DEFAULT '#6366F1',
  is_closed_won BOOLEAN NOT NULL DEFAULT false,
  is_closed_lost BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, pipeline_id, workspace_id),
  UNIQUE (pipeline_id, key),
  CONSTRAINT pipeline_stages_workspace_pipeline_fk FOREIGN KEY (pipeline_id, workspace_id)
    REFERENCES pipelines (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT pipeline_stages_closed_state_check CHECK (NOT (is_closed_won AND is_closed_lost))
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id UUID,
  primary_contact_id UUID,
  owner_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  pipeline_id UUID NOT NULL,
  stage_id UUID NOT NULL,
  source_lead_id UUID,
  name VARCHAR(200) NOT NULL CHECK (length(trim(name)) > 0),
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  probability NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  actual_close_date DATE,
  forecast_category VARCHAR(24),
  lead_source VARCHAR(80),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  lost_reason VARCHAR(500),
  next_activity_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  UNIQUE (id, pipeline_id, workspace_id),
  CONSTRAINT deals_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES accounts (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT deals_workspace_contact_fk FOREIGN KEY (primary_contact_id, workspace_id)
    REFERENCES contacts (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT deals_workspace_pipeline_fk FOREIGN KEY (pipeline_id, workspace_id)
    REFERENCES pipelines (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT deals_workspace_stage_fk FOREIGN KEY (stage_id, pipeline_id, workspace_id)
    REFERENCES pipeline_stages (id, pipeline_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT deals_workspace_lead_fk FOREIGN KEY (source_lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL,
  pipeline_id UUID NOT NULL,
  from_stage_id UUID,
  to_stage_id UUID NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_lead_id UUID,
  CONSTRAINT deal_stage_history_workspace_deal_fk FOREIGN KEY (deal_id, pipeline_id, workspace_id)
    REFERENCES deals (id, pipeline_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT deal_stage_history_workspace_pipeline_fk FOREIGN KEY (pipeline_id, workspace_id)
    REFERENCES pipelines (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT deal_stage_history_to_stage_fk FOREIGN KEY (to_stage_id, pipeline_id, workspace_id)
    REFERENCES pipeline_stages (id, pipeline_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT deal_stage_history_from_stage_fk FOREIGN KEY (from_stage_id, pipeline_id, workspace_id)
    REFERENCES pipeline_stages (id, pipeline_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT deal_stage_history_workspace_lead_fk FOREIGN KEY (source_lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pipelines_workspace_default_unique_idx
  ON pipelines (workspace_id)
  WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_email_unique_idx
  ON contacts (workspace_id, normalized_email)
  WHERE normalized_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_workspace_domain_unique_idx
  ON accounts (workspace_id, normalized_domain)
  WHERE normalized_domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS deals_workspace_source_lead_unique_idx
  ON deals (workspace_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS deal_stage_history_legacy_lead_unique_idx
  ON deal_stage_history (workspace_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_workspace_normalized_email_idx
  ON leads (workspace_id, normalized_email);
CREATE INDEX IF NOT EXISTS leads_workspace_normalized_phone_idx
  ON leads (workspace_id, normalized_phone);
CREATE INDEX IF NOT EXISTS customers_workspace_normalized_email_idx
  ON customers (workspace_id, normalized_email);
CREATE INDEX IF NOT EXISTS customers_workspace_normalized_phone_idx
  ON customers (workspace_id, normalized_phone);
CREATE INDEX IF NOT EXISTS accounts_workspace_name_idx
  ON accounts (workspace_id, normalized_name);
CREATE INDEX IF NOT EXISTS accounts_workspace_phone_idx
  ON accounts (workspace_id, normalized_phone);
CREATE INDEX IF NOT EXISTS contacts_workspace_account_idx
  ON contacts (workspace_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_workspace_phone_idx
  ON contacts (workspace_id, normalized_phone);
CREATE INDEX IF NOT EXISTS pipelines_workspace_idx
  ON pipelines (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_stages_pipeline_position_idx
  ON pipeline_stages (pipeline_id, position, id);
CREATE INDEX IF NOT EXISTS deals_workspace_stage_idx
  ON deals (workspace_id, stage_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS deals_workspace_owner_idx
  ON deals (workspace_id, owner_user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS deals_workspace_close_date_idx
  ON deals (workspace_id, expected_close_date, id);
CREATE INDEX IF NOT EXISTS deal_stage_history_deal_changed_idx
  ON deal_stage_history (workspace_id, deal_id, changed_at DESC, id DESC);

-- Seed one default pipeline for every existing workspace. New workspaces are
-- provisioned by server/pipelines.js using the same definitions.
UPDATE pipelines SET is_default = false WHERE is_default;

INSERT INTO pipelines (workspace_id, name, is_default, created_by, updated_by)
SELECT id, 'Default Sales Pipeline', true, owner_user_id, owner_user_id
FROM workspaces
ON CONFLICT (workspace_id, name) DO UPDATE
SET is_default = true, updated_at = NOW(), updated_by = EXCLUDED.updated_by;

INSERT INTO pipeline_stages (
  workspace_id, pipeline_id, key, name, position, probability, color,
  is_closed_won, is_closed_lost, created_by, updated_by
)
SELECT p.workspace_id, p.id, seed.key, seed.name, seed.position, seed.probability, seed.color,
       seed.is_closed_won, seed.is_closed_lost, p.created_by, p.updated_by
FROM pipelines p
CROSS JOIN (VALUES
  ('new', 'New Lead', 10, 10.00, '#3B82F6', false, false),
  ('qualified', 'Qualified', 20, 25.00, '#8B5CF6', false, false),
  ('follow-up', 'Follow-up', 30, 40.00, '#F59E0B', false, false),
  ('proposal', 'Proposal', 40, 60.00, '#10B981', false, false),
  ('closed-won', 'Closed Won', 50, 100.00, '#059669', true, false),
  ('closed-lost', 'Closed Lost', 60, 0.00, '#EF4444', false, true)
) AS seed(key, name, position, probability, color, is_closed_won, is_closed_lost)
WHERE p.name = 'Default Sales Pipeline'
ON CONFLICT (pipeline_id, key) DO NOTHING;

-- Create one normalized Account for each legacy company string. Leads without
-- a company use the person name so every migrated deal has an account trail.
INSERT INTO accounts (
  workspace_id, owner_user_id, created_by, updated_by, name, normalized_name
)
SELECT source.workspace_id,
       MIN(source.user_id),
       MIN(source.user_id),
       MIN(source.user_id),
       MIN(source.name),
       source.normalized_name
FROM (
  SELECT workspace_id, user_id,
         COALESCE(NULLIF(trim(company), ''), NULLIF(trim(name), '')) AS name,
         lower(COALESCE(NULLIF(trim(company), ''), NULLIF(trim(name), ''))) AS normalized_name
  FROM customers
  UNION ALL
  SELECT workspace_id, user_id,
         COALESCE(NULLIF(trim(company), ''), NULLIF(trim(name), '')) AS name,
         lower(COALESCE(NULLIF(trim(company), ''), NULLIF(trim(name), ''))) AS normalized_name
  FROM leads
) AS source
WHERE source.name IS NOT NULL
GROUP BY source.workspace_id, source.normalized_name
ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

-- Preserve customer records as contacts before merging lead contacts by email.
INSERT INTO contacts (
  workspace_id, account_id, owner_user_id, created_by, updated_by,
  name, email, normalized_email, phone, normalized_phone, source_customer_id
)
SELECT c.workspace_id,
       a.id,
       c.user_id,
       c.user_id,
       c.user_id,
       c.name,
       c.email,
       COALESCE(c.normalized_email, lower(trim(c.email))),
       c.phone,
       c.normalized_phone,
       c.id
FROM customers c
LEFT JOIN accounts a
  ON a.workspace_id = c.workspace_id
 AND a.normalized_name = lower(COALESCE(NULLIF(trim(c.company), ''), NULLIF(trim(c.name), '')))
ON CONFLICT (workspace_id, normalized_email) WHERE normalized_email IS NOT NULL DO UPDATE SET
  account_id = COALESCE(contacts.account_id, EXCLUDED.account_id),
  source_customer_id = COALESCE(contacts.source_customer_id, EXCLUDED.source_customer_id),
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

INSERT INTO contacts (
  workspace_id, account_id, owner_user_id, created_by, updated_by,
  name, email, normalized_email, phone, normalized_phone, source_lead_id
)
SELECT l.workspace_id,
       a.id,
       l.user_id,
       l.user_id,
       l.user_id,
       l.name,
       l.email,
       COALESCE(l.normalized_email, lower(trim(l.email))),
       l.phone,
       l.normalized_phone,
       l.id
FROM leads l
LEFT JOIN accounts a
  ON a.workspace_id = l.workspace_id
 AND a.normalized_name = lower(COALESCE(NULLIF(trim(l.company), ''), NULLIF(trim(l.name), '')))
ON CONFLICT (workspace_id, normalized_email) WHERE normalized_email IS NOT NULL DO UPDATE SET
  account_id = COALESCE(contacts.account_id, EXCLUDED.account_id),
  source_lead_id = COALESCE(contacts.source_lead_id, EXCLUDED.source_lead_id),
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

-- Convert every legacy lead into one traceable Deal. Legacy quote items remain
-- on leads; deal amount starts at zero until a verified amount is entered.
INSERT INTO deals (
  workspace_id, account_id, primary_contact_id, owner_user_id, created_by, updated_by,
  pipeline_id, stage_id, source_lead_id, name, amount, currency, probability,
  actual_close_date, forecast_category, lead_source, status, lost_reason, next_activity_date
)
SELECT l.workspace_id,
       COALESCE(a.id, c.account_id),
       c.id,
       l.user_id,
       l.user_id,
       l.user_id,
       p.id,
       s.id,
       l.id,
       l.name,
       COALESCE((
         SELECT ROUND(SUM(
           CASE
             WHEN (item->>'quantity') ~ '^[0-9]+(\\.[0-9]+)?$'
              AND (item->>'price') ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (item->>'quantity')::numeric * (item->>'price')::numeric
             ELSE 0
           END
         ), 2)
         FROM jsonb_array_elements(l.quote_items) AS item
       ), 0),
       w.base_currency,
       s.probability,
       CASE WHEN l.stage IN ('closed-won', 'closed-lost') THEN COALESCE(l.won_at, l.lost_at)::date ELSE NULL END,
       CASE
         WHEN l.stage = 'proposal' THEN 'best_case'
         WHEN l.stage = 'closed-won' THEN 'closed'
         WHEN l.stage = 'closed-lost' THEN 'omitted'
         ELSE 'pipeline'
       END,
       l.source,
       CASE WHEN l.stage = 'closed-won' THEN 'won' WHEN l.stage = 'closed-lost' THEN 'lost' ELSE 'open' END,
       NULL,
       NULL
FROM leads l
JOIN workspaces w ON w.id = l.workspace_id
JOIN pipelines p ON p.workspace_id = l.workspace_id AND p.is_default
JOIN pipeline_stages s ON s.pipeline_id = p.id AND s.key = l.stage
LEFT JOIN contacts c ON c.workspace_id = l.workspace_id AND c.normalized_email = l.normalized_email
LEFT JOIN accounts a
  ON a.workspace_id = l.workspace_id
 AND a.normalized_name = lower(NULLIF(trim(l.company), ''))
ON CONFLICT (workspace_id, source_lead_id) WHERE source_lead_id IS NOT NULL DO NOTHING;

INSERT INTO deal_stage_history (
  workspace_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by, changed_at, source_lead_id
)
SELECT d.workspace_id,
       d.id,
       d.pipeline_id,
       NULL,
       d.stage_id,
       d.owner_user_id,
       COALESCE(l.updated_at, l.created_at),
       l.id
FROM deals d
JOIN leads l ON l.id = d.source_lead_id AND l.workspace_id = d.workspace_id
ON CONFLICT (workspace_id, source_lead_id) WHERE source_lead_id IS NOT NULL DO NOTHING;

-- Fail the migration rather than silently switching reads with incomplete
-- traceability. Foreign keys cover cross-tenant references; these checks cover
-- the legacy-to-core backfill itself.
DO $$
DECLARE
  legacy_leads BIGINT;
  migrated_deals BIGINT;
  migrated_history BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_leads FROM leads;
  SELECT COUNT(*) INTO migrated_deals FROM deals WHERE source_lead_id IS NOT NULL;
  SELECT COUNT(*) INTO migrated_history FROM deal_stage_history WHERE source_lead_id IS NOT NULL;

  IF legacy_leads <> migrated_deals THEN
    RAISE EXCEPTION 'Phase 2 backfill incomplete: % leads but % migrated deals', legacy_leads, migrated_deals;
  END IF;
  IF legacy_leads <> migrated_history THEN
    RAISE EXCEPTION 'Phase 2 backfill incomplete: % leads but % stage history rows', legacy_leads, migrated_history;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM leads l
    LEFT JOIN deals d ON d.workspace_id = l.workspace_id AND d.source_lead_id = l.id
    LEFT JOIN contacts c ON c.workspace_id = d.workspace_id AND c.id = d.primary_contact_id
    LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
    WHERE d.id IS NULL OR c.id IS NULL OR a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 2 backfill created an orphaned legacy lead trace';
  END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('006_phase2_core_model')
ON CONFLICT (version) DO NOTHING;

COMMIT;
