import { randomUUID } from 'node:crypto';

import { verifyToken } from '@clerk/backend';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_BODY_LIMIT = 128 * 1024;

export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', JSON_CONTENT_TYPE);
  return res.end(JSON.stringify(payload));
}

export function noContent(res) {
  res.statusCode = 204;
  return res.end();
}

export function paginated(data, limit, offset) {
  const hasMore = data.length > limit;
  return {
    data: hasMore ? data.slice(0, limit) : data,
    pagination: {
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  };
}

export function getPagination(query = {}) {
  return {
    limit: readBoundedInteger(query.limit, 50, 1, 100, 'limit'),
    offset: readBoundedInteger(query.offset, 0, 0, 100_000, 'offset'),
  };
}

export function getRequiredId(query = {}) {
  const id = Array.isArray(query.id) ? query.id[0] : query.id;
  if (!isUuid(id)) {
    throw new HttpError(400, 'invalid_id', 'A valid resource ID is required.');
  }
  return id;
}

export function withApiRoute({ methods, handler, maxBodyBytes = DEFAULT_BODY_LIMIT }) {
  const allowedMethods = new Set(methods);

  return async function apiRoute(req, res) {
    const requestId = normalizeRequestId(req.headers['x-request-id']);
    setSecurityHeaders(res, requestId);

    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', [...allowedMethods, 'OPTIONS'].join(', '));
      return noContent(res);
    }

    if (!allowedMethods.has(req.method)) {
      res.setHeader('Allow', [...allowedMethods].join(', '));
      return json(res, 405, errorPayload('method_not_allowed', 'Method not allowed.', requestId));
    }

    try {
      enforceBodyLimit(req, maxBodyBytes);
      const userId = await authenticate(req);
      return await handler({ req, res, userId, requestId });
    } catch (error) {
      const databaseError = mapDatabaseError(error);
      const knownError = error instanceof HttpError ? error : databaseError;
      const statusCode = knownError?.statusCode ?? 500;
      const code = knownError?.code ?? 'internal_error';
      const message = knownError?.message ?? 'An unexpected error occurred.';

      if (statusCode >= 500) {
        console.error(JSON.stringify({
          level: 'error',
          requestId,
          method: req.method,
          path: req.url,
          error: error instanceof Error ? error.message : String(error),
        }));
      }

      return json(res, statusCode, errorPayload(code, message, requestId, knownError?.details));
    }
  };
}

async function authenticate(req) {
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string' && authorization.match(/^Bearer ([^\s]+)$/);

  if (!match) {
    throw new HttpError(401, 'unauthorized', 'Authentication is required.');
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  const jwtKey = process.env.CLERK_JWT_KEY;
  if (!secretKey && !jwtKey) {
    throw new Error('CLERK_SECRET_KEY or CLERK_JWT_KEY must be configured.');
  }

  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean);

  try {
    const verified = await verifyToken(match[1], {
      ...(secretKey ? { secretKey } : {}),
      ...(jwtKey ? { jwtKey } : {}),
      ...(authorizedParties?.length ? { authorizedParties } : {}),
    });

    if (!verified.sub) {
      throw new Error('Token has no subject.');
    }
    return verified.sub;
  } catch {
    throw new HttpError(401, 'unauthorized', 'Authentication is invalid or expired.');
  }
}

function enforceBodyLimit(req, maxBodyBytes) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return;

  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }

  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new HttpError(413, 'payload_too_large', 'Request body is too large.');
  }

  if (req.body !== undefined) {
    const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(serialized, 'utf8') > maxBodyBytes) {
      throw new HttpError(413, 'payload_too_large', 'Request body is too large.');
    }
  }
}

function setSecurityHeaders(res, requestId) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Request-Id', requestId);
}

function errorPayload(code, message, requestId, details) {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };
}

function readBoundedInteger(value, fallback, min, max, field) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined) return fallback;
  if (!/^\d+$/.test(String(candidate))) {
    throw new HttpError(400, 'invalid_query', `${field} must be an integer.`);
  }
  const parsed = Number(candidate);
  if (parsed < min || parsed > max) {
    throw new HttpError(400, 'invalid_query', `${field} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeRequestId(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function mapDatabaseError(error) {
  if (error?.code === '23505') {
    return new HttpError(409, 'conflict', 'A resource with these unique fields already exists.');
  }
  if (error?.code === '23503') {
    return new HttpError(400, 'invalid_reference', 'A referenced resource does not exist.');
  }
  if (error?.code === '22P02') {
    return new HttpError(400, 'invalid_value', 'A supplied value has an invalid format.');
  }
  return null;
}
