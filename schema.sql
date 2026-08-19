-- CRM Pro production schema for a fresh PostgreSQL/Neon database.
-- Existing installations should apply migrations/002_production_hardening.sql through
-- migrations/005_phase0_data_correctness.sql in order instead.

BEGIN;

CREATE TABLE schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL DEFAULT 'Personal CRM',
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX customers_workspace_email_unique_idx ON customers (workspace_id, lower(email));

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
CREATE UNIQUE INDEX workspace_invitations_pending_email_unique_idx
  ON workspace_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (lower(email), expires_at);

INSERT INTO schema_migrations (version) VALUES
  ('002_production_hardening'),
  ('003_workspace_foundation'),
  ('004_team_settings'),
  ('005_phase0_data_correctness');

COMMIT;
