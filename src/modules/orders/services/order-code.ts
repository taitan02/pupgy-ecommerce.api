/**
 * The code a buyer reads out to the shop: `PG260929-K4M2XQ`.
 *
 * Date first so a support conversation starts with "đơn hôm kia", then six random
 * characters from an alphabet with no 0/O or 1/I — the code gets read over the phone
 * and written by hand, and a pair that looks alike is a pair that gets transcribed
 * wrong. Randomness, not a counter: a sequential code tells competitors how many
 * orders the platform takes, and invites guessing at the next one.
 */
const ALPHABET = '23456789ACDEFGHJKLMNPQRSTUVWXYZ';

export function generateOrderCode(now = new Date()): string {
  const date = [now.getUTCFullYear() % 100, now.getUTCMonth() + 1, now.getUTCDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');

  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');

  return `PG${date}-${suffix}`;
}
