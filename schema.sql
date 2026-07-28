-- CRM Pro production schema for a fresh PostgreSQL/Neon database.
-- Existing installations should apply migrations/002_production_hardening.sql instead.

BEGIN;

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  lead_id UUID,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  date_time TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meetings_tenant_lead_fk FOREIGN KEY (lead_id, user_id)
    REFERENCES leads (id, user_id) ON DELETE CASCADE
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  type VARCHAR(80) NOT NULL CHECK (length(trim(type)) > 0),
  message VARCHAR(2000) NOT NULL CHECK (length(trim(message)) > 0),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  company VARCHAR(160),
  email VARCHAR(320) NOT NULL CHECK (position('@' IN email) > 1),
  phone VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX customers_user_email_unique_idx ON customers (user_id, lower(email));

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  CONSTRAINT invoices_tenant_customer_fk FOREIGN KEY (customer_id, user_id)
    REFERENCES customers (id, user_id) ON DELETE RESTRICT,
  UNIQUE (user_id, invoice_number)
);

CREATE INDEX leads_user_created_idx ON leads (user_id, created_at DESC, id DESC);
CREATE INDEX leads_user_stage_idx ON leads (user_id, stage, created_at DESC);
CREATE INDEX meetings_user_date_idx ON meetings (user_id, date_time, id);
CREATE INDEX activities_user_timestamp_idx ON activities (user_id, timestamp DESC, id DESC);
CREATE INDEX customers_user_created_idx ON customers (user_id, created_at DESC, id DESC);
CREATE INDEX invoices_user_created_idx ON invoices (user_id, created_at DESC, id DESC);
CREATE INDEX invoices_user_status_due_idx ON invoices (user_id, status, due_date);

COMMIT;
