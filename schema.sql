-- CRM Pro production schema for a fresh PostgreSQL/Neon database.
-- Existing installations should apply migrations/002_production_hardening.sql through
-- migrations/011_phase7_google_calendar.sql in order instead.

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
  legal_name VARCHAR(200),
  billing_email VARCHAR(320),
  billing_phone VARCHAR(40),
  billing_address JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(billing_address) = 'object'),
  tax_registration_id VARCHAR(120),
  quote_prefix VARCHAR(16) NOT NULL DEFAULT 'QUO',
  invoice_prefix VARCHAR(16) NOT NULL DEFAULT 'INV',
  credit_note_prefix VARCHAR(16) NOT NULL DEFAULT 'CRN',
  next_quote_number INTEGER NOT NULL DEFAULT 1 CHECK (next_quote_number > 0),
  next_invoice_number INTEGER NOT NULL DEFAULT 1 CHECK (next_invoice_number > 0),
  next_credit_note_number INTEGER NOT NULL DEFAULT 1 CHECK (next_credit_note_number > 0),
  default_quote_terms TEXT,
  default_invoice_terms TEXT,
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
  end_time TIMESTAMPTZ,
  notes TEXT,
  integration_id UUID,
  provider VARCHAR(40),
  external_event_id VARCHAR(512),
  meeting_url VARCHAR(1000),
  sync_status VARCHAR(24) NOT NULL DEFAULT 'local'
    CHECK (sync_status IN ('local', 'pending', 'synced', 'failed', 'deleted')),
  sync_error VARCHAR(1000),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meetings_workspace_lead_fk FOREIGN KEY (lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT meetings_end_after_start_check CHECK (end_time IS NULL OR end_time > date_time)
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  lead_id UUID,
  account_id UUID,
  contact_id UUID,
  deal_id UUID,
  type VARCHAR(80) NOT NULL CHECK (length(trim(type)) > 0),
  subject VARCHAR(200) NOT NULL CHECK (length(trim(subject)) > 0),
  description TEXT,
  message VARCHAR(2000) NOT NULL CHECK (length(trim(message)) > 0),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  owner_user_id TEXT NOT NULL,
  outcome VARCHAR(500),
  created_by TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  legacy_source_id UUID,
  legacy_source_type VARCHAR(32),
  source_type VARCHAR(40),
  source_id UUID
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

ALTER TABLE activities
  ADD CONSTRAINT activities_workspace_lead_fk FOREIGN KEY (lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE SET NULL,
  ADD CONSTRAINT activities_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES accounts (id, workspace_id) ON DELETE SET NULL,
  ADD CONSTRAINT activities_workspace_contact_fk FOREIGN KEY (contact_id, workspace_id)
    REFERENCES contacts (id, workspace_id) ON DELETE SET NULL,
  ADD CONSTRAINT activities_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
    REFERENCES deals (id, workspace_id) ON DELETE SET NULL;

CREATE TABLE record_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID,
  account_id UUID,
  contact_id UUID,
  deal_id UUID,
  author_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT record_notes_target_check CHECK (
    num_nonnulls(lead_id, account_id, contact_id, deal_id) = 1
  ),
  CONSTRAINT record_notes_workspace_lead_fk FOREIGN KEY (lead_id, workspace_id)
    REFERENCES leads (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT record_notes_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES accounts (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT record_notes_workspace_contact_fk FOREIGN KEY (contact_id, workspace_id)
    REFERENCES contacts (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT record_notes_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
    REFERENCES deals (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  resource VARCHAR(32) NOT NULL CHECK (resource IN ('leads', 'contacts', 'accounts', 'deals', 'activities', 'invoices')),
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  columns JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(columns) = 'array'),
  sort JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sort) = 'object'),
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, owner_user_id, resource, name)
);

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID,
  account_id UUID,
  contact_id UUID,
  source_lead_id UUID,
  quote_number VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled')),
  issue_date DATE NOT NULL,
  expiry_date DATE,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  discount_type VARCHAR(16) NOT NULL DEFAULT 'fixed'
    CHECK (discount_type IN ('fixed', 'percent')),
  discount_value NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes TEXT,
  terms TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  revision_of_quote_id UUID,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, quote_number, version),
  CONSTRAINT quotes_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
    REFERENCES deals(id, workspace_id) ON DELETE SET NULL (deal_id),
  CONSTRAINT quotes_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES accounts(id, workspace_id) ON DELETE SET NULL (account_id),
  CONSTRAINT quotes_workspace_contact_fk FOREIGN KEY (contact_id, workspace_id)
    REFERENCES contacts(id, workspace_id) ON DELETE SET NULL (contact_id),
  CONSTRAINT quotes_workspace_lead_fk FOREIGN KEY (source_lead_id, workspace_id)
    REFERENCES leads(id, workspace_id) ON DELETE SET NULL (source_lead_id),
  CONSTRAINT quotes_workspace_revision_fk FOREIGN KEY (revision_of_quote_id, workspace_id)
    REFERENCES quotes(id, workspace_id) ON DELETE SET NULL (revision_of_quote_id),
  CONSTRAINT quotes_expiry_check CHECK (expiry_date IS NULL OR expiry_date >= issue_date)
);

CREATE TABLE quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  description VARCHAR(500) NOT NULL CHECK (length(trim(description)) > 0),
  quantity NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_items_workspace_quote_fk FOREIGN KEY (quote_id, workspace_id)
    REFERENCES quotes(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (quote_id, position)
);

CREATE UNIQUE INDEX deal_stage_history_legacy_lead_unique_idx
  ON deal_stage_history (workspace_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  customer_id UUID NOT NULL,
  deal_id UUID,
  quote_id UUID,
  invoice_number VARCHAR(64) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL CHECK (due_date >= invoice_date),
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'partial', 'cancelled', 'void')),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  notes TEXT,
  terms TEXT,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_mode VARCHAR(16) NOT NULL DEFAULT 'exclusive'
    CHECK (tax_mode IN ('exclusive', 'inclusive', 'mixed')),
  tax_rate NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_type VARCHAR(16) NOT NULL DEFAULT 'fixed'
    CHECK (discount_type IN ('fixed', 'percent')),
  discount_value NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  credited_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  balance_due NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  sent_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT invoices_workspace_customer_fk FOREIGN KEY (customer_id, workspace_id)
    REFERENCES customers (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT invoices_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
    REFERENCES deals (id, workspace_id) ON DELETE SET NULL (deal_id),
  CONSTRAINT invoices_workspace_quote_fk FOREIGN KEY (quote_id, workspace_id)
    REFERENCES quotes (id, workspace_id) ON DELETE SET NULL (quote_id),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, invoice_number)
);

CREATE TABLE tax_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id UUID,
  invoice_id UUID,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
  rate NUMERIC(7, 4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  inclusive BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_components_target_check CHECK (num_nonnulls(quote_id, invoice_id) = 1),
  CONSTRAINT tax_components_workspace_quote_fk FOREIGN KEY (quote_id, workspace_id)
    REFERENCES quotes(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT tax_components_workspace_invoice_fk FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_date DATE NOT NULL,
  payment_method VARCHAR(80),
  transaction_reference VARCHAR(200),
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'settled' CHECK (status IN ('settled', 'void')),
  voided_at TIMESTAMPTZ,
  voided_by TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_workspace_invoice_fk FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices(id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  credit_note_number VARCHAR(64) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason VARCHAR(1000) NOT NULL CHECK (length(trim(reason)) > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_notes_workspace_invoice_fk FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices(id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, credit_note_number)
);

CREATE TABLE invoice_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id UUID,
  quote_id UUID,
  recipient VARCHAR(320) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  provider_message_id VARCHAR(256),
  status VARCHAR(24) NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason VARCHAR(1000),
  retry_of_id UUID,
  attempted_by TEXT NOT NULL,
  request_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_deliveries_target_check CHECK (num_nonnulls(invoice_id, quote_id) = 1),
  CONSTRAINT invoice_deliveries_workspace_invoice_fk FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT invoice_deliveries_workspace_quote_fk FOREIGN KEY (quote_id, workspace_id)
    REFERENCES quotes(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT invoice_deliveries_retry_fk FOREIGN KEY (retry_of_id)
    REFERENCES invoice_deliveries(id) ON DELETE SET NULL
);

CREATE TABLE financial_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN ('quote', 'invoice', 'payment', 'credit_note', 'financial_settings')),
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  request_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION prevent_financial_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Financial audit events are immutable';
END;
$$;

CREATE TRIGGER financial_audit_events_immutable
BEFORE UPDATE OR DELETE ON financial_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_financial_audit_mutation();

CREATE TABLE communication_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('email', 'calendar')),
  owner_user_id TEXT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'error', 'revoked')),
  external_account_id VARCHAR(320),
  calendar_id VARCHAR(512) DEFAULT 'primary',
  display_name VARCHAR(200),
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes) = 'array'),
  token_reference VARCHAR(500),
  token_expires_at TIMESTAMPTZ,
  sync_cursor TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error VARCHAR(1000),
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  CONSTRAINT communication_integrations_workspace_owner_fk FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_members(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE integration_credentials (
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

CREATE TABLE integration_oauth_states (
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

CREATE TABLE email_templates (
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

CREATE TABLE outbound_messages (
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

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  body VARCHAR(1000),
  entity_type VARCHAR(40),
  entity_id UUID,
  dedupe_key VARCHAR(240),
  action_url VARCHAR(500),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'dismissed')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  trigger_type VARCHAR(40) NOT NULL CHECK (trigger_type IN ('lead_created', 'deal_stage_changed', 'activity_overdue', 'invoice_overdue', 'deal_won')),
  conditions JSONB NOT NULL DEFAULT '{"all":[]}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  actions JSONB NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id)
);

CREATE TABLE automation_events (
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

CREATE TABLE automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  event_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'retry', 'succeeded', 'dead_letter')),
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
  CONSTRAINT automation_jobs_workspace_rule_fk FOREIGN KEY (rule_id, workspace_id) REFERENCES automation_rules(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT automation_jobs_workspace_event_fk FOREIGN KEY (event_id, workspace_id) REFERENCES automation_events(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE automation_action_runs (
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

CREATE TABLE audit_events (
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

CREATE TABLE api_rate_limit_counters (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject VARCHAR(256) NOT NULL,
  scope VARCHAR(80) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1 CHECK (hit_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, subject, scope, window_started_at)
);

CREATE TABLE sales_goals (
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

ALTER TABLE meetings ADD CONSTRAINT meetings_workspace_integration_fk
  FOREIGN KEY (integration_id, workspace_id)
  REFERENCES communication_integrations(id, workspace_id) ON DELETE RESTRICT;

CREATE INDEX leads_workspace_created_idx ON leads (workspace_id, created_at DESC, id DESC);
CREATE INDEX leads_workspace_stage_idx ON leads (workspace_id, stage, created_at DESC);
CREATE INDEX leads_workspace_won_idx ON leads (workspace_id, won_at DESC, id DESC);
CREATE INDEX leads_workspace_lost_idx ON leads (workspace_id, lost_at DESC, id DESC);
CREATE INDEX meetings_workspace_date_idx ON meetings (workspace_id, date_time, id);
CREATE INDEX activities_workspace_timestamp_idx ON activities (workspace_id, timestamp DESC, id DESC);
CREATE INDEX activities_workspace_owner_due_idx ON activities (workspace_id, owner_user_id, due_at, id);
CREATE INDEX activities_workspace_completed_idx ON activities (workspace_id, completed_at, due_at, id);
CREATE INDEX activities_workspace_lead_idx ON activities (workspace_id, lead_id, due_at DESC, id DESC);
CREATE INDEX activities_workspace_deal_idx ON activities (workspace_id, deal_id, due_at DESC, id DESC);
CREATE INDEX record_notes_workspace_lead_idx ON record_notes (workspace_id, lead_id, created_at DESC, id DESC);
CREATE INDEX record_notes_workspace_account_idx ON record_notes (workspace_id, account_id, created_at DESC, id DESC);
CREATE INDEX record_notes_workspace_contact_idx ON record_notes (workspace_id, contact_id, created_at DESC, id DESC);
CREATE INDEX record_notes_workspace_deal_idx ON record_notes (workspace_id, deal_id, created_at DESC, id DESC);
CREATE INDEX saved_views_workspace_resource_idx ON saved_views (workspace_id, resource, is_shared, updated_at DESC, id DESC);
CREATE INDEX customers_workspace_created_idx ON customers (workspace_id, created_at DESC, id DESC);
CREATE INDEX invoices_workspace_created_idx ON invoices (workspace_id, created_at DESC, id DESC);
CREATE INDEX invoices_workspace_status_due_idx ON invoices (workspace_id, status, due_date);
CREATE INDEX invoices_workspace_currency_idx ON invoices (workspace_id, currency, invoice_date DESC);
CREATE INDEX invoices_workspace_deal_idx ON invoices (workspace_id, deal_id, created_at DESC);
CREATE INDEX quotes_workspace_updated_idx ON quotes (workspace_id, updated_at DESC, id DESC);
CREATE INDEX quotes_workspace_deal_idx ON quotes (workspace_id, deal_id, updated_at DESC);
CREATE INDEX quote_items_quote_position_idx ON quote_items (workspace_id, quote_id, position);
CREATE INDEX payments_workspace_invoice_idx ON payments (workspace_id, invoice_id, payment_date DESC, id DESC);
CREATE INDEX payments_workspace_date_idx ON payments (workspace_id, payment_date DESC, id DESC);
CREATE INDEX credit_notes_workspace_invoice_idx ON credit_notes (workspace_id, invoice_id, issued_at DESC);
CREATE INDEX invoice_deliveries_workspace_invoice_idx ON invoice_deliveries (workspace_id, invoice_id, created_at DESC);
CREATE INDEX invoice_deliveries_workspace_quote_idx ON invoice_deliveries (workspace_id, quote_id, created_at DESC);
CREATE INDEX financial_audit_workspace_entity_idx ON financial_audit_events (workspace_id, entity_type, entity_id, created_at DESC);
CREATE UNIQUE INDEX communication_integrations_workspace_account_unique_idx
  ON communication_integrations (workspace_id, kind, provider, external_account_id)
  WHERE external_account_id IS NOT NULL;
CREATE UNIQUE INDEX communication_integrations_workspace_owner_provider_unique_idx
  ON communication_integrations (workspace_id, owner_user_id, kind, provider);
CREATE INDEX integration_oauth_states_expiry_idx ON integration_oauth_states (provider, expires_at, consumed_at);
CREATE INDEX integration_credentials_workspace_idx ON integration_credentials (workspace_id, integration_id);
CREATE UNIQUE INDEX email_templates_workspace_name_unique_idx ON email_templates (workspace_id, lower(name));
CREATE INDEX outbound_messages_workspace_created_idx ON outbound_messages (workspace_id, created_at DESC, id DESC);
CREATE INDEX outbound_messages_workspace_target_idx ON outbound_messages (workspace_id, deal_id, contact_id, lead_id, created_at DESC);
CREATE INDEX outbound_messages_workspace_status_idx ON outbound_messages (workspace_id, status, updated_at DESC, id DESC);
CREATE INDEX notifications_recipient_status_idx ON notifications (workspace_id, recipient_user_id, status, created_at DESC, id DESC);
CREATE UNIQUE INDEX notifications_workspace_recipient_dedupe_idx
  ON notifications (workspace_id, recipient_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX activities_workspace_source_idx
  ON activities (workspace_id, source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX automation_rules_workspace_trigger_idx ON automation_rules (workspace_id, trigger_type, status, updated_at DESC);
CREATE INDEX automation_jobs_ready_idx ON automation_jobs (status, available_at, created_at) WHERE status IN ('pending', 'retry');
CREATE INDEX automation_jobs_workspace_status_idx ON automation_jobs (workspace_id, status, created_at DESC);
CREATE INDEX audit_events_workspace_created_idx ON audit_events (workspace_id, created_at DESC, id DESC);
CREATE INDEX api_rate_limit_expiry_idx ON api_rate_limit_counters (expires_at);
CREATE UNIQUE INDEX sales_goals_active_quota_unique_idx
  ON sales_goals (workspace_id, metric, currency, period_start, period_end, COALESCE(owner_user_id, '__team__'))
  WHERE status = 'active';
CREATE INDEX sales_goals_workspace_period_idx ON sales_goals (workspace_id, period_start, period_end, status, id);
CREATE INDEX sales_goals_workspace_owner_idx ON sales_goals (workspace_id, owner_user_id, status, period_end DESC, id DESC);
CREATE UNIQUE INDEX meetings_workspace_external_event_unique_idx
  ON meetings (workspace_id, provider, external_event_id) WHERE external_event_id IS NOT NULL;
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
  ('006_phase2_core_model'),
  ('007_phase4_productivity'),
  ('008_phase5_quote_to_cash'),
  ('009_phase7_communications'),
  ('010_phase6_goals_quotas'),
  ('011_phase7_google_calendar');

COMMIT;
