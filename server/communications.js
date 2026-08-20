import { Resend } from 'resend';

export class CommunicationProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CommunicationProviderError';
    this.code = code;
  }
}

export function createEmailProvider(env = process.env) {
  const providerName = (env.CRM_EMAIL_PROVIDER || 'resend').trim().toLowerCase();
  const fromAddress = (env.CRM_FROM_EMAIL || env.INVOICE_FROM_EMAIL || '').trim();

  if (providerName !== 'resend') {
    return unavailableProvider(providerName, fromAddress, `Unsupported email provider: ${providerName}.`);
  }
  if (!env.RESEND_API_KEY || !fromAddress) {
    return unavailableProvider('resend', fromAddress, 'RESEND_API_KEY and a verified CRM_FROM_EMAIL or INVOICE_FROM_EMAIL sender must be configured.');
  }

  const resend = new Resend(env.RESEND_API_KEY);
  return {
    name: 'resend',
    fromAddress,
    configured: true,
    configurationError: null,
    async send({ recipient, subject, bodyText, bodyHtml, idempotencyKey }) {
      let response;
      try {
        response = await resend.emails.send({
          from: fromAddress,
          to: [recipient],
          subject,
          text: bodyText,
          html: bodyHtml || textToHtml(bodyText),
        }, { idempotencyKey });
      } catch (error) {
        throw new CommunicationProviderError('provider_unreachable', providerMessage(error));
      }
      if (response.error) {
        throw new CommunicationProviderError(response.error.name || 'provider_rejected', providerMessage(response.error));
      }
      return { providerMessageId: response.data.id, status: 'sent' };
    },
  };
}

export function textToHtml(value) {
  return String(value)
    .split(/\r?\n/)
    .map(line => line ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
    .join('');
}

export function providerMessage(error) {
  const value = typeof error?.message === 'string' ? error.message : 'The email provider rejected the message.';
  return value.slice(0, 1_000);
}

function unavailableProvider(name, fromAddress, configurationError) {
  return {
    name,
    fromAddress,
    configured: false,
    configurationError,
    async send() {
      throw new CommunicationProviderError('provider_not_configured', configurationError);
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
