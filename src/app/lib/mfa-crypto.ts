import 'server-only';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

function encryptionKey(secret = process.env.SESSION_SECRET) {
  if (!secret) throw new Error('SESSION_SECRET is required');
  // Rotating SESSION_SECRET requires re-encrypting MFA seeds before retiring
  // the old key. Domain separation prevents reuse of the JWT signing key.
  return Buffer.from(hkdfSync('sha256', secret, 'harbour-hair', 'admin-mfa-seed-v1', 32));
}

export function encryptMfaSecret(secret: string, sessionSecret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(sessionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptMfaSecret(encrypted: string, sessionSecret?: string): string {
  const [version, iv, tag, ciphertext, extra] = encrypted.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('Invalid MFA seed');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(sessionSecret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function newMfaSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function authenticatorUri(secret: string, email: string): string {
  return new TOTP({ issuer: 'Harbour Hair Salon', label: email, secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).toString();
}

export function matchTotpStep(secret: string, token: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const delta = TOTP.validate({ token, secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30, timestamp: now, window: 1 });
  return delta === null ? null : Math.floor(now / 30_000) + delta;
}

export function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g)!.join('-'));
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/[-\s]/g, '').toUpperCase()).digest('hex');
}
