export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}
export function normalizePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const candidate = String(value).trim();
  const digits = candidate.replace(/\D/g, '');
  if (!digits) return null;
  return candidate.startsWith('+') ? `+${digits}` : digits;
}

export function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  let normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  normalized = normalized.split(/[/?#]/, 1)[0];
  normalized = normalized.replace(/^www\./, '').replace(/:\d+$/, '').replace(/\.$/, '');
  return normalized || null;
}

export function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || null;
}
