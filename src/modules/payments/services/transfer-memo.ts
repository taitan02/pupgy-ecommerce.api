/**
 * Matching an order code inside a bank transfer memo.
 *
 * Banks mangle the description on the way through: punctuation disappears, case
 * changes, extra words get prepended by the sending bank. A transfer that a human
 * would call obviously correct arrives as `TU NGUYEN VAN A CHUYEN TIEN PG261004JUXXT7`
 * when the buyer was told to send `PG261004-JUXXT7`.
 *
 * So both sides are reduced to uppercase alphanumerics before comparing. The order
 * code carries enough entropy (six characters from a 31-letter alphabet, plus the
 * date) that a substring match is not a collision risk.
 */
export function normaliseMemo(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function memoContains(memo: string, orderCode: string): boolean {
  return normaliseMemo(memo).includes(normaliseMemo(orderCode));
}
