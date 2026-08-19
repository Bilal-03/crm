-- Phase 4: first-class activities/notes and data productivity foundations.
-- Apply after migrations/006_phase2_core_model.sql.
-- Take a database snapshot before applying this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS account_id UUID,
  ADD COLUMN IF NOT EXISTS contact_id UUID,
  ADD COLUMN IF NOT EXISTS deal_id UUID,
  ADD COLUMN IF NOT EXISTS subject VARCHAR(200),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(16) DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(500),
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legacy_source_id UUID,
  ADD COLUMN IF NOT EXISTS legacy_source_type VARCHAR(32);

UPDATE activities
SET
  subject = COALESCE(subject, NULLIF(left(message, 200), ''), initcap(replace(type, '_', ' '))),
  description = COALESCE(description, message),
  priority = COALESCE(priority, 'normal'),
  owner_user_id = COALESCE(owner_user_id, user_id),
  created_by = COALESCE(created_by, user_id),
  created_at = COALESCE(created_at, timestamp),
  updated_at = COALESCE(updated_at, timestamp);

ALTER TABLE activities
  ALTER COLUMN priority SET DEFAULT 'normal',
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN owner_user_id SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activities_priority_check'
      AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_workspace_lead_fk') THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_workspace_lead_fk FOREIGN KEY (lead_id, workspace_id)
      REFERENCES leads (id, workspace_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_workspace_account_fk') THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_workspace_account_fk FOREIGN KEY (account_id, workspace_id)
      REFERENCES accounts (id, workspace_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_workspace_contact_fk') THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_workspace_contact_fk FOREIGN KEY (contact_id, workspace_id)
      REFERENCES contacts (id, workspace_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_workspace_deal_fk') THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_workspace_deal_fk FOREIGN KEY (deal_id, workspace_id)
      REFERENCES deals (id, workspace_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS record_notes (
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

CREATE TABLE IF NOT EXISTS saved_views (
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

-- Preserve every legacy note as an independently attributed record.
INSERT INTO record_notes (id, workspace_id, lead_id, author_user_id, created_by, body, created_at, updated_at)
SELECT CASE
         WHEN value->>'id' ~ '^[0-9a-fA-F-]{36}$' THEN (value->>'id')::uuid
         ELSE md5(concat_ws('|', l.workspace_id::text, l.id::text, note.ordinal::text, value->>'text', value->>'timestamp'))::uuid
       END,
       l.workspace_id,
       l.id,
       l.user_id,
       l.user_id,
       trim(value->>'text'),
       CASE
         WHEN value->>'timestamp' IS NOT NULL THEN (value->>'timestamp')::timestamptz
         ELSE l.updated_at
       END,
       CASE
         WHEN value->>'timestamp' IS NOT NULL THEN (value->>'timestamp')::timestamptz
         ELSE l.updated_at
       END
FROM leads l
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.notes, '[]'::jsonb)) WITH ORDINALITY AS note(value, ordinal)
WHERE NULLIF(trim(value->>'text'), '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Convert reminders to activities without removing the legacy JSON fields yet.
-- Keeping the fields during the compatibility window lets older clients continue
-- to read them while all new writes use the first-class activity contract.
INSERT INTO activities (
  workspace_id, user_id, lead_id, type, subject, description, message, due_at,
  completed_at, priority, owner_user_id, created_by, timestamp, created_at,
  updated_at, legacy_source_id, legacy_source_type
)
SELECT l.workspace_id,
       l.user_id,
       l.id,
       'task',
       left(COALESCE(NULLIF(trim(value->>'note'), ''), 'Follow-up'), 200),
       value->>'note',
       left(COALESCE(NULLIF(trim(value->>'note'), ''), 'Follow-up'), 2000),
       ((value->>'date')::date::timestamp AT TIME ZONE w.timezone),
       CASE
         WHEN COALESCE((value->>'completed')::boolean, false)
           THEN COALESCE(NULLIF(value->>'completedAt', '')::timestamptz, l.updated_at)
         ELSE NULL
       END,
       'normal',
       l.user_id,
       l.user_id,
       COALESCE(NULLIF(value->>'createdAt', '')::timestamptz, l.updated_at),
       COALESCE(NULLIF(value->>'createdAt', '')::timestamptz, l.updated_at),
       l.updated_at,
       CASE
         WHEN value->>'id' ~ '^[0-9a-fA-F-]{36}$' THEN (value->>'id')::uuid
         ELSE md5(concat_ws('|', l.workspace_id::text, l.id::text, reminder.ordinal::text, value->>'date', value->>'note', value->>'createdAt'))::uuid
       END,
       'legacy_reminder'
FROM leads l
JOIN workspaces w ON w.id = l.workspace_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.reminders, '[]'::jsonb)) WITH ORDINALITY AS reminder(value, ordinal)
WHERE value->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
  AND (
    value->>'id' IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM activities existing
      WHERE existing.workspace_id = l.workspace_id
        AND existing.legacy_source_id = CASE
          WHEN value->>'id' ~ '^[0-9a-fA-F-]{36}$' THEN (value->>'id')::uuid
          ELSE md5(concat_ws('|', l.workspace_id::text, l.id::text, reminder.ordinal::text, value->>'date', value->>'note', value->>'createdAt'))::uuid
        END
    )
  );

CREATE INDEX IF NOT EXISTS activities_workspace_owner_due_idx
  ON activities (workspace_id, owner_user_id, due_at, id);
CREATE INDEX IF NOT EXISTS activities_workspace_completed_idx
  ON activities (workspace_id, completed_at, due_at, id);
CREATE INDEX IF NOT EXISTS activities_workspace_lead_idx
  ON activities (workspace_id, lead_id, due_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activities_workspace_deal_idx
  ON activities (workspace_id, deal_id, due_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS record_notes_workspace_lead_idx
  ON record_notes (workspace_id, lead_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS record_notes_workspace_account_idx
  ON record_notes (workspace_id, account_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS record_notes_workspace_contact_idx
  ON record_notes (workspace_id, contact_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS record_notes_workspace_deal_idx
  ON record_notes (workspace_id, deal_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS saved_views_workspace_resource_idx
  ON saved_views (workspace_id, resource, is_shared, updated_at DESC, id DESC);

INSERT INTO schema_migrations (version) VALUES ('007_phase4_productivity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
