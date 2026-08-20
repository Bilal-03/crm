-- Phase 5: quote-to-cash and financial integrity.
-- Apply after migrations/007_phase4_productivity.sql.
-- Take a database snapshot before applying this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS legal_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS billing_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_registration_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS quote_prefix VARCHAR(16) NOT NULL DEFAULT 'QUO',
  ADD COLUMN IF NOT EXISTS invoice_prefix VARCHAR(16) NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS credit_note_prefix VARCHAR(16) NOT NULL DEFAULT 'CRN',
  ADD COLUMN IF NOT EXISTS next_quote_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_invoice_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_credit_note_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_quote_terms TEXT,
  ADD COLUMN IF NOT EXISTS default_invoice_terms TEXT;

CREATE TABLE IF NOT EXISTS quotes (
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

CREATE TABLE IF NOT EXISTS quote_items (
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

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS deal_id UUID,
  ADD COLUMN IF NOT EXISTS quote_id UUID,
  ADD COLUMN IF NOT EXISTS currency CHAR(3),
  ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(16) NOT NULL DEFAULT 'exclusive',
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(16) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

UPDATE invoices i
SET
  currency = COALESCE(i.currency, w.base_currency),
  discount_value = CASE WHEN i.discount_value = 0 THEN i.discount_amount ELSE i.discount_value END,
  sent_at = COALESCE(i.sent_at, CASE WHEN i.status IN ('sent', 'paid', 'partial', 'overdue') THEN i.updated_at END),
  created_by = COALESCE(i.created_by, i.user_id),
  updated_by = COALESCE(i.updated_by, i.user_id)
FROM workspaces w
WHERE w.id = i.workspace_id;

ALTER TABLE invoices
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL;

-- The original workspace migration added this tenant-safe unique key to leads
-- and customers, but not invoices. Composite financial foreign keys require it.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_id_workspace_unique_idx
  ON invoices (id, workspace_id);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_currency_format_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_tax_mode_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_discount_type_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_discount_value_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_credited_amount_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_workspace_deal_fk;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_workspace_quote_fk;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'partial', 'cancelled', 'void')),
  ADD CONSTRAINT invoices_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT invoices_tax_mode_check CHECK (tax_mode IN ('exclusive', 'inclusive', 'mixed')),
  ADD CONSTRAINT invoices_discount_type_check CHECK (discount_type IN ('fixed', 'percent')),
  ADD CONSTRAINT invoices_discount_value_check CHECK (discount_value >= 0),
  ADD CONSTRAINT invoices_credited_amount_check CHECK (credited_amount >= 0),
  ADD CONSTRAINT invoices_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
    REFERENCES deals(id, workspace_id) ON DELETE SET NULL (deal_id),
  ADD CONSTRAINT invoices_workspace_quote_fk FOREIGN KEY (quote_id, workspace_id)
    REFERENCES quotes(id, workspace_id) ON DELETE SET NULL (quote_id);

CREATE TABLE IF NOT EXISTS tax_components (
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

INSERT INTO tax_components (workspace_id, invoice_id, name, rate, amount, inclusive, position)
SELECT workspace_id, id, 'Tax', tax_rate, tax_amount, false, 0
FROM invoices
WHERE tax_rate > 0
  AND NOT EXISTS (SELECT 1 FROM tax_components t WHERE t.invoice_id = invoices.id);

CREATE TABLE IF NOT EXISTS payments (
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

INSERT INTO payments (
  workspace_id, invoice_id, amount, currency, payment_date,
  payment_method, notes, created_by, created_at
)
SELECT i.workspace_id,
       i.id,
       LEAST(CASE WHEN i.status = 'paid' THEN i.total_amount ELSE i.amount_paid END, i.total_amount),
       i.currency,
       COALESCE(i.paid_at, i.updated_at, i.created_at)::date,
       'legacy',
       'Backfilled from the pre-Phase 5 invoice paid balance.',
       i.user_id,
       COALESCE(i.paid_at, i.updated_at, i.created_at)
FROM invoices i
WHERE (CASE WHEN i.status = 'paid' THEN i.total_amount ELSE i.amount_paid END) > 0
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id);

CREATE TABLE IF NOT EXISTS credit_notes (
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

CREATE TABLE IF NOT EXISTS invoice_deliveries (
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

CREATE TABLE IF NOT EXISTS financial_audit_events (
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

DROP TRIGGER IF EXISTS financial_audit_events_immutable ON financial_audit_events;
CREATE TRIGGER financial_audit_events_immutable
BEFORE UPDATE OR DELETE ON financial_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_financial_audit_mutation();

-- Preserve legacy quote content as one traceable draft quote per lead. The
-- lead JSON remains available to older application versions during rollout.
INSERT INTO quotes (
  workspace_id, deal_id, account_id, contact_id, source_lead_id,
  quote_number, version, status, issue_date, currency,
  subtotal, total_amount, terms, created_by, updated_by, created_at, updated_at
)
SELECT l.workspace_id,
       d.id,
       d.account_id,
       d.primary_contact_id,
       l.id,
       'LEGACY-Q-' || upper(left(replace(l.id::text, '-', ''), 12)),
       1,
       'draft',
       l.created_at::date,
       COALESCE(d.currency, w.base_currency),
       COALESCE(items.total, 0),
       COALESCE(items.total, 0),
       w.default_quote_terms,
       l.user_id,
       l.user_id,
       l.created_at,
       l.updated_at
FROM leads l
JOIN workspaces w ON w.id = l.workspace_id
LEFT JOIN deals d ON d.workspace_id = l.workspace_id AND d.source_lead_id = l.id
LEFT JOIN LATERAL (
  SELECT ROUND(SUM(
    CASE
      WHEN (item->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (item->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (item->>'quantity')::numeric * (item->>'price')::numeric
      ELSE 0
    END
  ), 2) AS total
  FROM jsonb_array_elements(l.quote_items) item
) items ON true
WHERE jsonb_array_length(l.quote_items) > 0
ON CONFLICT (workspace_id, quote_number, version) DO NOTHING;

INSERT INTO quote_items (
  workspace_id, quote_id, position, description, quantity, unit_price, amount
)
SELECT q.workspace_id,
       q.id,
       (entry.ordinality - 1)::int,
       COALESCE(NULLIF(trim(entry.item->>'description'), ''), 'Legacy quote item'),
       CASE WHEN (entry.item->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$' THEN (entry.item->>'quantity')::numeric ELSE 1 END,
       CASE WHEN (entry.item->>'price') ~ '^[0-9]+(\.[0-9]+)?$' THEN (entry.item->>'price')::numeric ELSE 0 END,
       ROUND(
         (CASE WHEN (entry.item->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$' THEN (entry.item->>'quantity')::numeric ELSE 1 END)
         *
         (CASE WHEN (entry.item->>'price') ~ '^[0-9]+(\.[0-9]+)?$' THEN (entry.item->>'price')::numeric ELSE 0 END),
         2
       )
FROM quotes q
JOIN leads l ON l.id = q.source_lead_id AND l.workspace_id = q.workspace_id
CROSS JOIN LATERAL jsonb_array_elements(l.quote_items) WITH ORDINALITY AS entry(item, ordinality)
ON CONFLICT (quote_id, position) DO NOTHING;

UPDATE workspaces w
SET
  next_quote_number = GREATEST(w.next_quote_number, (SELECT COUNT(*)::int + 1 FROM quotes q WHERE q.workspace_id = w.id)),
  next_invoice_number = GREATEST(w.next_invoice_number, (SELECT COUNT(*)::int + 1 FROM invoices i WHERE i.workspace_id = w.id));

UPDATE invoices i
SET
  amount_paid = COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'settled'), 0),
  credited_amount = COALESCE((SELECT SUM(c.amount) FROM credit_notes c WHERE c.invoice_id = i.id AND c.status = 'issued'), 0),
  balance_due = CASE
    WHEN i.status IN ('cancelled', 'void') THEN 0
    ELSE GREATEST(
      i.total_amount
      - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'settled'), 0)
      - COALESCE((SELECT SUM(c.amount) FROM credit_notes c WHERE c.invoice_id = i.id AND c.status = 'issued'), 0),
      0
    )
  END;

CREATE INDEX IF NOT EXISTS quotes_workspace_updated_idx ON quotes (workspace_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS quotes_workspace_deal_idx ON quotes (workspace_id, deal_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS quote_items_quote_position_idx ON quote_items (workspace_id, quote_id, position);
CREATE INDEX IF NOT EXISTS invoices_workspace_currency_idx ON invoices (workspace_id, currency, invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_workspace_deal_idx ON invoices (workspace_id, deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_workspace_invoice_idx ON payments (workspace_id, invoice_id, payment_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS payments_workspace_date_idx ON payments (workspace_id, payment_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS credit_notes_workspace_invoice_idx ON credit_notes (workspace_id, invoice_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS invoice_deliveries_workspace_invoice_idx ON invoice_deliveries (workspace_id, invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoice_deliveries_workspace_quote_idx ON invoice_deliveries (workspace_id, quote_id, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_audit_workspace_entity_idx ON financial_audit_events (workspace_id, entity_type, entity_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM leads l
    WHERE jsonb_array_length(l.quote_items) > 0
      AND NOT EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.workspace_id = l.workspace_id AND q.source_lead_id = l.id
      )
  ) THEN
    RAISE EXCEPTION 'Phase 5 quote backfill incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id AND i.workspace_id = p.workspace_id
    WHERE p.currency <> i.currency
  ) THEN
    RAISE EXCEPTION 'Phase 5 payment currency mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM invoices i
    WHERE i.status NOT IN ('cancelled', 'void')
      AND i.balance_due <> GREATEST(i.total_amount - i.amount_paid - i.credited_amount, 0)
  ) THEN
    RAISE EXCEPTION 'Phase 5 invoice reconciliation failed';
  END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('008_phase5_quote_to_cash')
ON CONFLICT (version) DO NOTHING;

COMMIT;
