import { HttpError } from '../http.js';

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events.owned',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_URL = 'https://www.googleapis.com/calendar/v3';

export function getGoogleCalendarConfig(env = process.env) {
  const config = {
    clientId: env.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET?.trim(),
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI?.trim(),
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  return { ...config, configured: missing.length === 0, missing };
}

export function createGoogleAuthorizationUrl({ state, env = process.env }) {
  const config = requireConfig(env);
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state,
  }).toString();
  return url.toString();
}

export function googleEventId(meetingId) {
  const normalized = String(meetingId || '').replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) throw new Error('A valid meeting UUID is required.');
  return `crm${normalized}`;
}

export function createGoogleCalendarProvider({ env = process.env, fetchImpl = fetch } = {}) {
  const config = requireConfig(env);

  async function request(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(15_000) });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error_description || body?.error?.message || `Google Calendar request failed (${response.status}).`);
      error.status = response.status;
      error.providerCode = body?.error?.status || body?.error || 'google_calendar_error';
      throw error;
    }
    return body;
  }

  async function tokenRequest(parameters) {
    return request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
    });
  }

  return {
    name: 'google',
    exchangeCode(code) {
      return tokenRequest({ code, redirect_uri: config.redirectUri, grant_type: 'authorization_code' });
    },
    refreshAccessToken(refreshToken) {
      return tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    },
    getProfile(accessToken) {
      return request('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    },
    revoke(token) {
      return request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    },
    async upsertEvent({ accessToken, calendarId = 'primary', meeting, timezone, createMeetingUrl = true }) {
      const eventId = googleEventId(meeting.id);
      const event = {
        id: eventId,
        summary: meeting.title,
        description: meeting.notes || undefined,
        start: { dateTime: new Date(meeting.date_time).toISOString(), timeZone: timezone || 'UTC' },
        end: { dateTime: meeting.end_time ? new Date(meeting.end_time).toISOString() : new Date(new Date(meeting.date_time).getTime() + 3_600_000).toISOString(), timeZone: timezone || 'UTC' },
        ...(createMeetingUrl ? { conferenceData: { createRequest: { requestId: `crm-${meeting.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      };
      const query = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'all' });
      const base = `${API_URL}/calendars/${encodeURIComponent(calendarId)}/events`;
      try {
        return await request(`${base}?${query}`, {
          method: 'POST',
          headers: jsonHeaders(accessToken),
          body: JSON.stringify(event),
        });
      } catch (error) {
        if (error.status !== 409) throw error;
        return request(`${base}/${encodeURIComponent(eventId)}?${query}`, {
          method: 'PUT',
          headers: jsonHeaders(accessToken),
          body: JSON.stringify(event),
        });
      }
    },
    async deleteEvent({ accessToken, calendarId = 'primary', eventId }) {
      try {
        await request(`${API_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (error) {
        if (![404, 410].includes(error.status)) throw error;
      }
    },
  };
}

function jsonHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

function requireConfig(env) {
  const config = getGoogleCalendarConfig(env);
  if (!config.configured) {
    throw new HttpError(503, 'calendar_not_configured', `Google Calendar configuration is incomplete: ${config.missing.join(', ')}.`);
  }
  return config;
}
