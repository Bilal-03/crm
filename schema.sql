-- CRM Pro production schema for a fresh PostgreSQL/Neon database.
-- Existing installations should apply migrations/002_production_hardening.sql through
-- migrations/006_phase2_core_model.sql in order instead.

BEGIN;

CREATE TABLE schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL DEFAULT 'Personal CRM',
  base_currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (base_currency ~ '^[A-Z]{3}$'),
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email VARCHAR(320),
  role VARCHAR(16) NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

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

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  company VARCHAR(160),
  email VARCHAR(320) NOT NULL CHECK (position('@' IN email) > 1),
  phone VARCHAR(40),
  normalized_email VARCHAR(320),
  normalized_phone VARCHAR(40),
  source VARCHAR(80),
  stage VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'qualified', 'follow-up', 'proposal', 'closed-won', 'closed-lost')),
  notes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notes) = 'array'),
  reminders JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reminders) = 'array'),
  quote_items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quote_items) = 'array'),
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  lead_id UUID,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  date_time TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meetings_workspace_lead_fk FOREIGN KEY (lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  type VARCHAR(80) NOT NULL CHECK (length(trim(type)) > 0),
  message VARCHAR(2000) NOT NULL CHECK (length(trim(message)) > 0),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  company VARCHAR(160),
  email VARCHAR(320) NOT NULL CHECK (position('@' IN email) > 1),
  phone VARCHAR(40),
  normalized_email VARCHAR(320),
  normalized_phone VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX customers_workspace_email_unique_idx ON customers (workspace_id, lower(email));

CREATE TABLE accounts (
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

CREATE TABLE contacts (
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

CREATE UNIQUE INDEX contacts_workspace_email_unique_idx
  ON contacts (workspace_id, normalized_email)
  WHERE normalized_email IS NOT NULL;

CREATE UNIQUE INDEX accounts_workspace_domain_unique_idx
  ON accounts (workspace_id, normalized_domain)
  WHERE normalized_domain IS NOT NULL;

CREATE TABLE pipelines (
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

CREATE UNIQUE INDEX pipelines_workspace_default_unique_idx
  ON pipelines (workspace_id)
  WHERE is_default;

CREATE TABLE pipeline_stages (
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

CREATE TABLE deals (
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

CREATE UNIQUE INDEX deals_workspace_source_lead_unique_idx
  ON deals (workspace_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;

CREATE TABLE deal_stage_history (
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

CREATE UNIQUE INDEX deal_stage_history_legacy_lead_unique_idx
  ON deal_stage_history (workspace_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  customer_id UUID NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL CHECK (due_date >= invoice_date),
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'partial', 'cancelled')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  notes TEXT,
  terms TEXT,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_rate NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  balance_due NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT invoices_workspace_customer_fk FOREIGN KEY (customer_id, workspace_id)
    REFERENCES customers (id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, invoice_number)
);

CREATE INDEX leads_workspace_created_idx ON leads (workspace_id, created_at DESC, id DESC);
CREATE INDEX leads_workspace_stage_idx ON leads (workspace_id, stage, created_at DESC);
CREATE INDEX leads_workspace_won_idx ON leads (workspace_id, won_at DESC, id DESC);
CREATE INDEX leads_workspace_lost_idx ON leads (workspace_id, lost_at DESC, id DESC);
CREATE INDEX meetings_workspace_date_idx ON meetings (workspace_id, date_time, id);
CREATE INDEX activities_workspace_timestamp_idx ON activities (workspace_id, timestamp DESC, id DESC);
CREATE INDEX customers_workspace_created_idx ON customers (workspace_id, created_at DESC, id DESC);
CREATE INDEX invoices_workspace_created_idx ON invoices (workspace_id, created_at DESC, id DESC);
CREATE INDEX invoices_workspace_status_due_idx ON invoices (workspace_id, status, due_date);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id, workspace_id);
CREATE INDEX leads_workspace_normalized_email_idx ON leads (workspace_id, normalized_email);
CREATE INDEX leads_workspace_normalized_phone_idx ON leads (workspace_id, normalized_phone);
CREATE INDEX customers_workspace_normalized_email_idx ON customers (workspace_id, normalized_email);
CREATE INDEX customers_workspace_normalized_phone_idx ON customers (workspace_id, normalized_phone);
CREATE INDEX accounts_workspace_name_idx ON accounts (workspace_id, normalized_name);
CREATE INDEX accounts_workspace_phone_idx ON accounts (workspace_id, normalized_phone);
CREATE INDEX contacts_workspace_account_idx ON contacts (workspace_id, account_id, created_at DESC);
CREATE INDEX contacts_workspace_phone_idx ON contacts (workspace_id, normalized_phone);
CREATE INDEX pipelines_workspace_idx ON pipelines (workspace_id, created_at DESC);
CREATE INDEX pipeline_stages_pipeline_position_idx ON pipeline_stages (pipeline_id, position, id);
CREATE INDEX deals_workspace_stage_idx ON deals (workspace_id, stage_id, updated_at DESC, id DESC);
CREATE INDEX deals_workspace_owner_idx ON deals (workspace_id, owner_user_id, updated_at DESC, id DESC);
CREATE INDEX deals_workspace_close_date_idx ON deals (workspace_id, expected_close_date, id);
CREATE INDEX deal_stage_history_deal_changed_idx ON deal_stage_history (workspace_id, deal_id, changed_at DESC, id DESC);
CREATE UNIQUE INDEX workspace_invitations_pending_email_unique_idx
  ON workspace_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (lower(email), expires_at);

INSERT INTO schema_migrations (version) VALUES
  ('002_production_hardening'),
  ('003_workspace_foundation'),
  ('004_team_settings'),
  ('005_phase0_data_correctness'),
  ('006_phase2_core_model');

COMMIT;
