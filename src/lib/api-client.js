const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClientError extends Error {
  constructor(message, { status = 0, code = 'request_failed', requestId } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createApiClient(getToken, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return {
    async request(endpoint, options = {}) {
      const token = await getToken();
      if (!token) throw new ApiClientError('Your session has expired. Please sign in again.', { status: 401, code: 'unauthorized' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const body = options.body && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body;

      try {
        const response = await fetch(`/api${endpoint}`, {
          ...options,
          body,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers,
          },
        });

        if (response.status === 204) return null;
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const error = payload?.error;
          throw new ApiClientError(error?.message || 'The request could not be completed.', {
            status: response.status,
            code: error?.code,
            requestId: error?.requestId || response.headers.get('x-request-id'),
          });
        }
        return payload?.data ?? payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new ApiClientError('The request timed out. Please try again.', { code: 'timeout' });
        }
        if (error instanceof ApiClientError) throw error;
        throw new ApiClientError('The service is temporarily unreachable. Please try again.');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
