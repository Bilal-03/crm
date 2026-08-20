import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.SMOKE_DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SMOKE_DATABASE_URL to an isolated PostgreSQL/Neon database before running the fresh-database smoke check.');
  process.exit(1);
}

const sql = neon(databaseUrl);
const requiredTables = [
  'workspaces', 'workspace_members', 'workspace_invitations', 'leads', 'meetings', 'activities',
  'customers', 'accounts', 'contacts', 'pipelines', 'pipeline_stages', 'deals', 'deal_stage_history',
  'quotes', 'quote_items', 'invoices', 'tax_components', 'payments', 'credit_notes',
  'invoice_deliveries', 'financial_audit_events', 'schema_migrations',
  'communication_integrations', 'email_templates', 'outbound_messages', 'notifications',
  'sales_goals',
  'integration_credentials', 'integration_oauth_states',
  'automation_rules', 'automation_events', 'automation_jobs', 'automation_action_runs',
  'audit_events', 'api_rate_limit_counters',
];
const tables = await sql`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = ANY(${requiredTables}::text[])
`;
const presentTables = new Set(tables.map(row => row.table_name));
const missingTables = requiredTables.filter(table => !presentTables.has(table));

const columns = await sql`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name = 'workspaces' AND column_name IN ('base_currency', 'timezone', 'invoice_prefix', 'quote_prefix'))
      OR (table_name = 'workspace_members' AND column_name = 'email')
      OR (table_name = 'leads' AND column_name IN ('won_at', 'lost_at', 'normalized_email', 'normalized_phone'))
      OR (table_name = 'customers' AND column_name IN ('normalized_email', 'normalized_phone'))
      OR (table_name = 'deals' AND column_name IN ('amount', 'probability', 'expected_close_date'))
      OR (table_name = 'meetings' AND column_name IN ('provider', 'external_event_id', 'meeting_url', 'sync_status', 'last_synced_at', 'end_time'))
      OR (table_name = 'invoices' AND column_name IN ('currency', 'quote_id', 'credited_amount', 'sent_at'))
      OR (table_name = 'notifications' AND column_name IN ('dedupe_key', 'action_url', 'metadata'))
      OR (table_name = 'activities' AND column_name IN ('source_type', 'source_id')))
`;
const presentColumns = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
const requiredColumns = [
  'workspaces.base_currency', 'workspaces.timezone', 'workspaces.invoice_prefix', 'workspaces.quote_prefix', 'workspace_members.email',
  'leads.won_at', 'leads.lost_at', 'leads.normalized_email', 'leads.normalized_phone',
  'customers.normalized_email', 'customers.normalized_phone', 'deals.amount',
  'deals.probability', 'deals.expected_close_date', 'invoices.currency', 'invoices.quote_id',
  'invoices.credited_amount', 'invoices.sent_at',
  'meetings.provider', 'meetings.external_event_id', 'meetings.meeting_url',
  'meetings.sync_status', 'meetings.last_synced_at',
  'meetings.end_time',
  'notifications.dedupe_key', 'notifications.action_url', 'notifications.metadata',
  'activities.source_type', 'activities.source_id',
];
const missingColumns = requiredColumns.filter(column => !presentColumns.has(column));

const migrations = await sql`SELECT version FROM schema_migrations ORDER BY version`;
const presentMigrations = new Set(migrations.map(row => row.version));
const requiredMigrations = [
  '002_production_hardening', '003_workspace_foundation', '004_team_settings',
  '005_phase0_data_correctness', '006_phase2_core_model', '007_phase4_productivity',
  '008_phase5_quote_to_cash',
  '009_phase7_communications',
  '010_phase6_goals_quotas',
  '011_phase7_google_calendar',
  '012_phase7_completion',
  '013_phase8_automation',
  '014_phase8_security',
];
const missingMigrations = requiredMigrations.filter(version => !presentMigrations.has(version));

if (missingTables.length || missingColumns.length || missingMigrations.length) {
  console.error(JSON.stringify({ missingTables, missingColumns, missingMigrations }, null, 2));
  process.exit(1);
}

console.log('Fresh-database schema smoke check passed. No data was written.');
