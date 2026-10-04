import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * SePay's HMAC-SHA256 webhook verification, exactly as documented.
 *
 *   X-SePay-Signature: sha256={hex}
 *   X-SePay-Timestamp: {unix seconds}
 *   signed string:     `{timestamp}.{raw body}`
 *
 * Three things here are easy to get wrong and impossible to notice until a real
 * payment is rejected:
 *
 * 1. **The body must be the raw bytes that arrived.** Parsing JSON and
 *    re-serialising it changes key order, whitespace and Unicode escaping — and this
 *    payload carries Vietnamese text in `description`, so it will differ. Nest hands
 *    us `rawBody` precisely for this.
 * 2. **Hex, not base64.**
 * 3. **The comparison must be constant time.** A `===` on a signature leaks it one
 *    byte at a time to anyone who can measure the response.
 */
export const SIGNATURE_HEADER = 'x-sepay-signature';
export const TIMESTAMP_HEADER = 'x-sepay-timestamp';

/** SePay's documented freshness window. A replayed body outside it is refused even
 *  though its signature is perfectly valid. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

export type VerificationFailure = 'missing-headers' | 'bad-timestamp' | 'stale' | 'bad-signature';

export function verifySepaySignature(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  secret: string;
  now?: Date;
}): VerificationFailure | null {
  const { rawBody, signatureHeader, timestampHeader, secret } = input;
  if (!signatureHeader || !timestampHeader) return 'missing-headers';

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return 'bad-timestamp';

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  // Absolute difference, not "older than": a timestamp far in the future is just as
  // much a forged one as a timestamp far in the past.
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) return 'stale';

  const expected = createHmac('sha256', secret)
    .update(`${timestampHeader}.`)
    .update(rawBody)
    .digest('hex');

  return equalsConstantTime(stripPrefix(signatureHeader), expected) ? null : 'bad-signature';
}

/** `sha256=abc…` → `abc…`. A header without the prefix is passed through rather than
 *  rejected outright; the signature comparison is what decides. */
function stripPrefix(signature: string): string {
  return signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on unequal lengths, which would itself be a signal, so the
  // length check is folded into the result instead of short-circuiting.
  return left.length === right.length && timingSafeEqual(left, right);
}
