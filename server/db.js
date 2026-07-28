import { neon } from '@neondatabase/serverless';

let database;

export function getDb() {
  if (!process.env.NEON_DATABASE_URL) {
    throw new Error('NEON_DATABASE_URL is not configured.');
  }
  database ??= neon(process.env.NEON_DATABASE_URL);
  return database;
}
