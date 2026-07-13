import { neon } from '@neondatabase/serverless';

export function getDb() {
  if (!process.env.NEON_DATABASE_URL) {
    throw new Error('NEON_DATABASE_URL is not set. Please set it in your .env or Vercel Environment Variables.');
  }
  return neon(process.env.NEON_DATABASE_URL);
}
