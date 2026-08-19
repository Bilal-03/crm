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

export function createApiClient(getToken, { timeoutMs = DEFAULT_TIMEOUT_MS, workspaceId = null } = {}) {
  return {
    async request(endpoint, options = {}) {
      const { includeMeta = false, ...requestOptions } = options;
      const token = await getToken();
      if (!token) throw new ApiClientError('Your session has expired. Please sign in again.', { status: 401, code: 'unauthorized' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const body = requestOptions.body && typeof requestOptions.body !== 'string'
        ? JSON.stringify(requestOptions.body)
        : requestOptions.body;

      try {
        const response = await fetch(`/api${endpoint}`, {
          ...requestOptions,
          body,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
            ...requestOptions.headers,
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
        if (includeMeta) return payload;
        const data = payload?.data ?? payload;
        if (payload?.pagination && data && typeof data === 'object') {
          Object.defineProperty(data, 'pagination', {
            value: payload.pagination,
            enumerable: false,
            configurable: true,
          });
        }
        return data;
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
    async requestPage(endpoint, options = {}) {
      return this.request(endpoint, { ...options, includeMeta: true });
    },
  };
}

export async function fetchAllPages(client, endpoint, options = {}) {
  const pageSize = options.pageSize || 100;
  const requestOptions = { ...options };
  delete requestOptions.pageSize;

  const [path, rawQuery = ''] = endpoint.split('?');
  const query = new URLSearchParams(rawQuery);
  const rows = [];
  let page = 1;
  let pagination = null;

  for (let requestCount = 0; requestCount < 10_000; requestCount += 1) {
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
    const response = await client.requestPage(`${path}?${query.toString()}`, requestOptions);
    const pageRows = Array.isArray(response?.data) ? response.data : [];
    rows.push(...pageRows);
    pagination = response?.pagination || null;
    if (!pagination?.hasMore) break;
    const nextPage = Number(pagination.nextPage || page + 1);
    if (!Number.isInteger(nextPage) || nextPage <= page) {
      throw new ApiClientError('The server returned invalid pagination metadata.', { code: 'invalid_pagination' });
    }
    page = nextPage;
  }

  if (pagination?.hasMore) {
    throw new ApiClientError('The result set is larger than the supported page limit.', { code: 'pagination_limit' });
  }

  Object.defineProperty(rows, 'pagination', {
    value: pagination ? { ...pagination, page: 1, offset: 0, pageSize, limit: pageSize } : null,
    enumerable: false,
    configurable: true,
  });
  return rows;
}
