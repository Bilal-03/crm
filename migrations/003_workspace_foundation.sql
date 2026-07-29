-- Adds personal workspaces without changing the visibility of existing CRM data.
-- Apply after 002_production_hardening.sql and take a database backup first.

BEGIN;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL DEFAULT 'Personal CRM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Provision one personal workspace per existing account and record its owner.
INSERT INTO workspaces (owner_user_id, name)
SELECT DISTINCT user_id, 'Personal CRM' FROM (
  SELECT user_id FROM leads
  UNION SELECT user_id FROM meetings
  UNION SELECT user_id FROM activities
  UNION SELECT user_id FROM customers
  UNION SELECT user_id FROM invoices
) AS existing_users
ON CONFLICT (owner_user_id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_user_id, 'owner' FROM workspaces
ON CONFLICT (workspace_id, user_id) DO NOTHING;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS workspace_id UUID;

UPDATE leads r SET workspace_id = w.id FROM workspaces w WHERE r.workspace_id IS NULL AND r.user_id = w.owner_user_id;
UPDATE meetings r SET workspace_id = w.id FROM workspaces w WHERE r.workspace_id IS NULL AND r.user_id = w.owner_user_id;
UPDATE activities r SET workspace_id = w.id FROM workspaces w WHERE r.workspace_id IS NULL AND r.user_id = w.owner_user_id;
UPDATE customers r SET workspace_id = w.id FROM workspaces w WHERE r.workspace_id IS NULL AND r.user_id = w.owner_user_id;
UPDATE invoices r SET workspace_id = w.id FROM workspaces w WHERE r.workspace_id IS NULL AND r.user_id = w.owner_user_id;

ALTER TABLE leads ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE meetings ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE activities ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE leads ADD CONSTRAINT leads_id_workspace_unique UNIQUE (id, workspace_id);
ALTER TABLE customers ADD CONSTRAINT customers_id_workspace_unique UNIQUE (id, workspace_id);
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_tenant_lead_fk;
ALTER TABLE meetings ADD CONSTRAINT meetings_workspace_lead_fk
  FOREIGN KEY (lead_id, workspace_id) REFERENCES leads (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_tenant_customer_fk;
ALTER TABLE invoices ADD CONSTRAINT invoices_workspace_customer_fk
  FOREIGN KEY (customer_id, workspace_id) REFERENCES customers (id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE leads ADD CONSTRAINT leads_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE meetings ADD CONSTRAINT meetings_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE activities ADD CONSTRAINT activities_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE customers ADD CONSTRAINT customers_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE invoices ADD CONSTRAINT invoices_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS customers_user_email_unique_idx;
DROP INDEX IF EXISTS invoices_user_number_unique_idx;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_user_number_unique;
CREATE UNIQUE INDEX customers_workspace_email_unique_idx ON customers (workspace_id, lower(email));
CREATE UNIQUE INDEX invoices_workspace_number_unique_idx ON invoices (workspace_id, invoice_number);
CREATE INDEX leads_workspace_created_idx ON leads (workspace_id, created_at DESC, id DESC);
CREATE INDEX meetings_workspace_date_idx ON meetings (workspace_id, date_time, id);
CREATE INDEX activities_workspace_timestamp_idx ON activities (workspace_id, timestamp DESC, id DESC);
CREATE INDEX customers_workspace_created_idx ON customers (workspace_id, created_at DESC, id DESC);
CREATE INDEX invoices_workspace_created_idx ON invoices (workspace_id, created_at DESC, id DESC);

COMMIT;
