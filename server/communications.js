import { Resend } from 'resend';
import { BRAND_COLORS, PRODUCT_BRAND } from '../brand.js';

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
          html: brandEmailHtml(bodyText, bodyHtml),
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

export function brandEmailHtml(bodyText, bodyHtml) {
  const content = bodyHtml || textToHtml(bodyText);
  return `<!doctype html><html><body style="margin:0;background:#F4F8FB;color:${BRAND_COLORS.text};font-family:Arial,Helvetica,sans-serif;line-height:1.6"><div style="max-width:620px;margin:24px auto;padding:0 16px"><div style="border-radius:16px 16px 0 0;background:${BRAND_COLORS.ink};padding:20px 24px"><div style="font-size:20px;font-weight:800;letter-spacing:-.04em;color:#fff">CRM <span style="color:${BRAND_COLORS.accent}">Pro</span></div><div style="margin-top:4px;color:rgba(255,255,255,.65);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${escapeHtml(PRODUCT_BRAND.tagline)}</div></div><div style="border:1px solid ${BRAND_COLORS.border};border-top:0;border-radius:0 0 16px 16px;background:#fff;padding:28px 24px">${content}<div style="margin-top:28px;padding-top:16px;border-top:1px solid ${BRAND_COLORS.border};color:${BRAND_COLORS.muted};font-size:12px">Sent from ${escapeHtml(PRODUCT_BRAND.name)}.</div></div></div></body></html>`;
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
