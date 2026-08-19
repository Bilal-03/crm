import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.SMOKE_DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SMOKE_DATABASE_URL to an isolated PostgreSQL/Neon database before running the fresh-database smoke check.');
  process.exit(1);
}

const sql = neon(databaseUrl);
const requiredTables = ['workspaces', 'workspace_members', 'workspace_invitations', 'leads', 'meetings', 'activities', 'customers', 'invoices', 'schema_migrations'];
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
    AND ((table_name = 'workspace_members' AND column_name = 'email')
      OR (table_name = 'leads' AND column_name IN ('won_at', 'lost_at')))
`;
const presentColumns = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
const requiredColumns = ['workspace_members.email', 'leads.won_at', 'leads.lost_at'];
const missingColumns = requiredColumns.filter(column => !presentColumns.has(column));

const migrations = await sql`SELECT version FROM schema_migrations ORDER BY version`;
const presentMigrations = new Set(migrations.map(row => row.version));
const requiredMigrations = ['002_production_hardening', '003_workspace_foundation', '004_team_settings', '005_phase0_data_correctness'];
const missingMigrations = requiredMigrations.filter(version => !presentMigrations.has(version));

if (missingTables.length || missingColumns.length || missingMigrations.length) {
  console.error(JSON.stringify({ missingTables, missingColumns, missingMigrations }, null, 2));
  process.exit(1);
}

console.log('Fresh-database schema smoke check passed. No data was written.');
