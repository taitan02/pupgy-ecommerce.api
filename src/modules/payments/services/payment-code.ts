/**
 * The reference a buyer types into their transfer memo: `PAY4K2M9XQ`.
 *
 * Deliberately not the order code: one payment can cover several orders, and a memo
 * naming one of them would be wrong about the rest. Same alphabet as the order code —
 * no 0/O or 1/I, because this gets read off a screen and typed into a banking app.
 */
const ALPHABET = '23456789ACDEFGHJKLMNPQRSTUVWXYZ';

export function generatePaymentCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `PAY${Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')}`;
}
