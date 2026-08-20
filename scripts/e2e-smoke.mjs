const baseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, '');
const token = process.env.E2E_CLERK_TOKEN;
if (!baseUrl || !token) {
  if (process.env.E2E_REQUIRED === '1') {
    console.error('E2E smoke requires E2E_BASE_URL and E2E_CLERK_TOKEN.');
    process.exit(1);
  }
  console.log('E2E smoke skipped: set E2E_BASE_URL and E2E_CLERK_TOKEN to test a deployed environment.');
  process.exit(0);
}

const headers = { Authorization: `Bearer ${token}` };
if (process.env.E2E_WORKSPACE_ID) headers['X-Workspace-Id'] = process.env.E2E_WORKSPACE_ID;

for (const endpoint of ['/api/dashboard', '/api/automations?pageSize=10', '/api/communication-status']) {
  const response = await fetch(`${baseUrl}${endpoint}`, { headers });
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error(`${endpoint} returned an invalid API contract.`);
  console.log(`E2E ${endpoint}: ${response.status}`);
}
