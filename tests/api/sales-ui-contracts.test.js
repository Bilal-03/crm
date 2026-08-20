import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const salesSource = fs.readFileSync(new URL('../../src/features/sales/SalesWorkspace.jsx', import.meta.url), 'utf8');

test('sales form primary actions submit their enclosing forms', () => {
  const submitButtons = salesSource.match(/<PrimaryButton type="submit"/g) || [];
  assert.equal(submitButtons.length, 2, 'deal and account/contact forms must both expose submit buttons');
});

test('account websites accept hostnames and are normalized before saving', () => {
  assert.match(salesSource, /website: normalizeWebsite\(form\.website\)/);
  assert.match(salesSource, /return `https:\/\/\$\{website\}`/);
  assert.doesNotMatch(salesSource, /<Field label="Website"><input type="url"/);
});
