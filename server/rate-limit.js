import { HttpError } from './http.js';

export async function consumeRateLimit(sql, {
  workspaceId,
  subject,
  scope,
  limit,
  windowSeconds,
}) {
  const now = Date.now();
  const windowMs = windowSeconds * 1_000;
  const startedAt = new Date(Math.floor(now / windowMs) * windowMs).toISOString();
  const expiresAt = new Date(Math.floor(now / windowMs) * windowMs + windowMs).toISOString();
  const rows = await sql`
    INSERT INTO api_rate_limit_counters (
      workspace_id, subject, scope, window_started_at, hit_count, expires_at
    ) VALUES (${workspaceId}, ${subject}, ${scope}, ${startedAt}, 1, ${expiresAt})
    ON CONFLICT (workspace_id, subject, scope, window_started_at)
    DO UPDATE SET hit_count = api_rate_limit_counters.hit_count + 1
    RETURNING hit_count
  `;
  if (Number(rows[0]?.hit_count || 0) > limit) {
    throw new HttpError(429, 'rate_limit_exceeded', 'Too many requests. Please wait before trying again.', {
      retryAfter: Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 1_000)),
      scope,
    });
  }
}
