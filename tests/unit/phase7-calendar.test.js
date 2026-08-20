import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleAuthorizationUrl, createGoogleCalendarProvider, googleEventId } from '../../server/calendar-providers/google.js';
import { decryptSecret, encryptSecret, hashOAuthState } from '../../server/integration-secrets.js';

const ENV = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://crm.example.com/api/integrations/google-calendar/callback',
  INTEGRATION_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const MEETING_ID = '11111111-1111-4111-8111-111111111111';

test('integration credentials encrypt with authenticated randomized ciphertext', () => {
  const first = encryptSecret('refresh-token', ENV);
  const second = encryptSecret('refresh-token', ENV);
  assert.notEqual(first, second);
  assert.equal(decryptSecret(first, ENV), 'refresh-token');
  assert.equal(hashOAuthState('state'), hashOAuthState('state'));
  const tamperedParts = first.split('.');
  const tamperedCiphertext = Buffer.from(tamperedParts[3], 'base64url');
  tamperedCiphertext[0] ^= 1;
  tamperedParts[3] = tamperedCiphertext.toString('base64url');
  assert.throws(() => decryptSecret(tamperedParts.join('.'), ENV));
});

test('Google authorization requests offline access and a state-bound calendar scope', () => {
  const url = new URL(createGoogleAuthorizationUrl({ state: 'one-time-state', env: ENV }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'one-time-state');
  assert.match(url.searchParams.get('scope'), /calendar\.events\.owned/);
});

test('Google event writes use a deterministic ID and update after an insert conflict', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return jsonResponse(409, { error: { message: 'Already exists' } });
    return jsonResponse(200, { id: googleEventId(MEETING_ID), hangoutLink: 'https://meet.google.com/test' });
  };
  const provider = createGoogleCalendarProvider({ env: ENV, fetchImpl });
  const result = await provider.upsertEvent({
    accessToken: 'access-token',
    meeting: { id: MEETING_ID, title: 'Demo', date_time: '2026-08-21T10:00:00Z', notes: '' },
    timezone: 'Asia/Kolkata',
  });
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].options.method, 'PUT');
  assert.match(calls[1].url, new RegExp(googleEventId(MEETING_ID)));
  assert.equal(result.hangoutLink, 'https://meet.google.com/test');
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
