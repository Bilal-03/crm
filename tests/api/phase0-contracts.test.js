import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient, fetchAllPages } from '../../src/lib/api-client.js';
import { getPagination, paginated } from '../../server/http.js';

test('pagination accepts page/pageSize and returns a complete contract', () => {
  assert.deepEqual(getPagination({ page: '3', pageSize: '25' }), {
    page: 3,
    pageSize: 25,
    limit: 25,
    offset: 50,
  });

  const response = paginated([{ id: 51 }], { page: 3, pageSize: 25, offset: 50 }, 51);
  assert.deepEqual(response.pagination, {
    page: 3,
    pageSize: 25,
    total: 51,
    totalPages: 3,
    offset: 50,
    limit: 25,
    hasMore: false,
    nextPage: null,
    nextOffset: null,
  });
});

test('the browser collection helper follows server pagination metadata', async () => {
  const requestedPages = [];
  const client = {
    async requestPage(endpoint) {
      const url = new URL(`https://crm.test${endpoint}`);
      const page = Number(url.searchParams.get('page'));
      requestedPages.push(page);
      return {
        data: [{ id: page }],
        pagination: {
          page,
          pageSize: 100,
          total: 201,
          totalPages: 3,
          hasMore: page < 3,
          nextPage: page < 3 ? page + 1 : null,
        },
      };
    },
  };

  const rows = await fetchAllPages(client, '/leads', { pageSize: 100 });
  assert.deepEqual(requestedPages, [1, 2, 3]);
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3]);
  assert.equal(rows.pagination.total, 201);
});

test('the API client retains pagination metadata for existing array callers', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    async json() {
      return {
        data: [{ id: 'lead-1' }],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasMore: false },
      };
    },
  });

  try {
    const client = createApiClient(async () => 'test-token');
    const rows = await client.request('/leads');
    assert.deepEqual(rows.map(row => row.id), ['lead-1']);
    assert.equal(rows.pagination.total, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
