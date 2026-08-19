import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateActivity,
  validateBulkAssignment,
  validateImportRequest,
  validateMergeRequest,
  validateRecordNote,
  validateSavedView,
} from '../../server/validation.js';

const leadId = '00000000-0000-4000-8000-000000000001';
const accountId = '00000000-0000-4000-8000-000000000002';
const ownerId = 'user_phase4_owner';

test('activity validation produces canonical due, priority and ownership fields', () => {
  const activity = validateActivity({
    lead_id: leadId,
    type: 'task',
    subject: 'Follow up',
    due_at: '2026-08-20T09:00:00+05:30',
    priority: 'high',
    owner_user_id: ownerId,
  });

  assert.deepEqual(activity, {
    lead_id: leadId,
    type: 'task',
    subject: 'Follow up',
    due_at: '2026-08-20T03:30:00.000Z',
    priority: 'high',
    owner_user_id: ownerId,
  });
  assert.throws(() => validateActivity({ type: 'task' }), /Request validation failed/);
  assert.throws(() => validateActivity({ type: 'task', subject: 'Call', priority: 'invalid' }), /Request validation failed/);
});

test('notes require exactly one workspace record target', () => {
  assert.deepEqual(validateRecordNote({ lead_id: leadId, body: 'Important context' }), {
    lead_id: leadId,
    body: 'Important context',
  });
  assert.throws(() => validateRecordNote({ body: 'No target' }), /Request validation failed/);
  assert.throws(() => validateRecordNote({ lead_id: leadId, account_id: accountId, body: 'Two targets' }), /Request validation failed/);
});

test('saved views and bulk assignment validate their bounded contracts', () => {
  assert.deepEqual(validateSavedView({ name: 'My overdue work', filters: { bucket: 'overdue' } }), {
    resource: 'activities',
    name: 'My overdue work',
    filters: { bucket: 'overdue' },
    columns: [],
    sort: {},
    is_shared: false,
    is_pinned: false,
  });
  assert.deepEqual(validateBulkAssignment({ resource: 'activities', ids: [leadId], owner_user_id: ownerId }), {
    resource: 'activities',
    ids: [leadId],
    owner_user_id: ownerId,
  });
  assert.throws(() => validateBulkAssignment({ ids: [leadId], owner_user_id: '' }), /Request validation failed/);
});

test('import and merge requests expose explicit preview-safe inputs', () => {
  assert.deepEqual(validateImportRequest({
    resource: 'leads',
    mode: 'dry_run',
    rows: [{ Name: 'Ada' }],
    mapping: { name: 'Name' },
  }), {
    resource: 'leads',
    mode: 'dry_run',
    rows: [{ Name: 'Ada' }],
    mapping: { name: 'Name' },
  });
  assert.deepEqual(validateMergeRequest({ resource: 'leads', survivor_id: leadId, duplicate_ids: [accountId] }), {
    resource: 'leads',
    survivor_id: leadId,
    duplicate_ids: [accountId],
  });
  assert.throws(() => validateMergeRequest({ survivor_id: leadId, duplicate_ids: [leadId] }), /Request validation failed/);
});
