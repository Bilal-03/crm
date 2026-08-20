import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmailProvider, textToHtml } from '../../server/communications.js';
import { validateEmailTemplate, validateOutboundMessage } from '../../server/validation.js';

const TARGET_ID = '11111111-1111-4111-8111-111111111111';

test('Phase 7 validates templates and normalized outbound email contracts', () => {
  assert.deepEqual(validateEmailTemplate({
    name: ' Follow-up ', subject: ' Next steps ', body_text: ' Thank you ',
  }), {
    name: 'Follow-up', subject: 'Next steps', body_text: 'Thank you',
  });
  assert.deepEqual(validateOutboundMessage({
    recipient: 'CUSTOMER@EXAMPLE.COM', subject: ' Hello ', body_text: ' Body ',
    idempotency_key: 'message_1234', contact_id: TARGET_ID,
  }), {
    recipient: 'customer@example.com', subject: 'Hello', body_text: 'Body',
    idempotency_key: 'message_1234', contact_id: TARGET_ID,
  });
});

test('Phase 7 requires exactly one CRM timeline target and safe idempotency keys', () => {
  assert.throws(() => validateOutboundMessage({
    recipient: 'customer@example.com', subject: 'Hello', body_text: 'Body',
    idempotency_key: 'message 1234', contact_id: TARGET_ID,
  }), /Request validation failed/);
  assert.throws(() => validateOutboundMessage({
    recipient: 'customer@example.com', subject: 'Hello', body_text: 'Body',
    idempotency_key: 'message_1234', contact_id: TARGET_ID, deal_id: TARGET_ID,
  }), /Request validation failed/);
});

test('provider-neutral email rendering escapes untrusted plain text', () => {
  assert.equal(textToHtml('Hello <customer>\n\nThanks & goodbye'), '<p>Hello &lt;customer&gt;</p><p><br></p><p>Thanks &amp; goodbye</p>');
  const provider = createEmailProvider({ CRM_EMAIL_PROVIDER: 'resend' });
  assert.equal(provider.name, 'resend');
  assert.equal(provider.configured, false);
  assert.match(provider.configurationError, /RESEND_API_KEY/);
});
