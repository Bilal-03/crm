import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function encryptionKey(env = process.env) {
  const configured = env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!configured) throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY is not configured.');
  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptSecret(value, env = process.env) {
  if (typeof value !== 'string' || !value) throw new Error('A non-empty secret is required.');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value, env = process.env) {
  const [version, encodedIv, encodedTag, encodedValue, extra] = String(value || '').split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedValue || extra) {
    throw new Error('Stored integration credential has an invalid format.');
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(env), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashOAuthState(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
