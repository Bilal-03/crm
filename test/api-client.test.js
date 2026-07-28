import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiClientError, createApiClient } from '../src/lib/api-client.js';

test('API client authenticates, serializes JSON, and unwraps data', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ data: { id: 'lead-1' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const client = createApiClient(async () => 'session-token');
    const result = await client.request('/leads', { method: 'POST', body: { name: 'Ada' } });

    assert.deepEqual(result, { id: 'lead-1' });
    assert.equal(captured.url, '/api/leads');
    assert.equal(captured.options.body, JSON.stringify({ name: 'Ada' }));
    assert.equal(captured.options.headers.Authorization, 'Bearer session-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client exposes safe structured server errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: 'validation_error', message: 'Request validation failed.', requestId: 'request-123' },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    const client = createApiClient(async () => 'session-token');
    await assert.rejects(
      () => client.request('/leads'),
      error => error instanceof ApiClientError
        && error.status === 400
        && error.code === 'validation_error'
        && error.requestId === 'request-123',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
