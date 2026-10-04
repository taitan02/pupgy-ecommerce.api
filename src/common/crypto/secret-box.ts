import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for secrets we have to hand back in the clear.
 *
 * Everything else in this system is hashed — passwords, refresh tokens, reset tokens —
 * because we only ever need to *compare* them. A webhook secret is different: verifying
 * an HMAC means recomputing it, which needs the real key. Hash what you compare,
 * encrypt what you must replay (ADR-014).
 *
 * AES-256-GCM, so the ciphertext is authenticated: tampering is detected on decrypt
 * rather than silently producing a wrong key and an unexplained signature mismatch.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, what GCM is specified for
const KEY_BYTES = 32;

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  // iv.tag.ciphertext in one string: the parts travel together or not at all, and a
  // column holding half of them is useless rather than subtly wrong.
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

export function decryptSecret(encoded: string, key: Buffer): string {
  const [iv, tag, ciphertext] = encoded.split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !ciphertext) throw new Error('Malformed encrypted secret');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** The key as bytes, validated once at boot rather than on the first webhook. */
export function keyFromBase64(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}
