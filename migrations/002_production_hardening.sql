-- One-time migration from the original prototype schema to the production contract.
-- Take a database snapshot before applying this migration.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE invoices RENAME COLUMN issue_date TO invoice_date;
ALTER TABLE invoices ALTER COLUMN invoice_date TYPE DATE USING NULLIF(invoice_date, '')::date;
ALTER TABLE invoices ALTER COLUMN due_date TYPE DATE USING NULLIF(due_date, '')::date;
ALTER TABLE invoices RENAME COLUMN amount TO total_amount;
ALTER TABLE invoices
  ADD COLUMN discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN balance_due NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN paid_at TIMESTAMPTZ;

UPDATE invoices
SET
  invoice_date = COALESCE(invoice_date, created_at::date),
  due_date = COALESCE(due_date, created_at::date + 30),
  total_amount = COALESCE(total_amount, subtotal + tax_amount, 0),
  balance_due = GREATEST(COALESCE(total_amount, 0) - amount_paid, 0);

ALTER TABLE invoices
  ALTER COLUMN invoice_date SET NOT NULL,
  ALTER COLUMN due_date SET NOT NULL,
  ALTER COLUMN invoice_number TYPE VARCHAR(64),
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN items SET NOT NULL,
  ALTER COLUMN subtotal SET NOT NULL,
  ALTER COLUMN tax_rate SET NOT NULL,
  ALTER COLUMN tax_amount SET NOT NULL,
  ALTER COLUMN total_amount SET NOT NULL;

-- Consolidate duplicate customer emails before adding the tenant-scoped unique index.
WITH ranked AS (
  SELECT id, user_id, first_value(id) OVER (
    PARTITION BY user_id, lower(email) ORDER BY created_at, id
  ) AS canonical_id
  FROM customers
), duplicates AS (
  SELECT id, canonical_id FROM ranked WHERE id <> canonical_id
)
UPDATE invoices i SET customer_id = d.canonical_id
FROM duplicates d WHERE i.customer_id = d.id;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, lower(email) ORDER BY created_at, id
  ) AS position
  FROM customers
)
DELETE FROM customers c USING ranked r WHERE c.id = r.id AND r.position > 1;

ALTER TABLE leads ADD CONSTRAINT leads_id_user_unique UNIQUE (id, user_id);
ALTER TABLE customers ADD CONSTRAINT customers_id_user_unique UNIQUE (id, user_id);
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_lead_id_fkey;
ALTER TABLE meetings ADD CONSTRAINT meetings_tenant_lead_fk
  FOREIGN KEY (lead_id, user_id) REFERENCES leads (id, user_id) ON DELETE CASCADE;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_customer_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_customer_fk
  FOREIGN KEY (customer_id, user_id) REFERENCES customers (id, user_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX customers_user_email_unique_idx ON customers (user_id, lower(email));
CREATE UNIQUE INDEX invoices_user_number_unique_idx ON invoices (user_id, invoice_number);
CREATE INDEX leads_user_created_idx ON leads (user_id, created_at DESC, id DESC);
CREATE INDEX leads_user_stage_idx ON leads (user_id, stage, created_at DESC);
CREATE INDEX meetings_user_date_idx ON meetings (user_id, date_time, id);
CREATE INDEX activities_user_timestamp_idx ON activities (user_id, timestamp DESC, id DESC);
CREATE INDEX customers_user_created_idx ON customers (user_id, created_at DESC, id DESC);
CREATE INDEX invoices_user_created_idx ON invoices (user_id, created_at DESC, id DESC);
CREATE INDEX invoices_user_status_due_idx ON invoices (user_id, status, due_date);

COMMIT;
