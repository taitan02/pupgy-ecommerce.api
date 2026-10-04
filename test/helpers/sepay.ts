import { createHmac } from 'node:crypto';

/**
 * Signs a webhook body the way SePay does.
 *
 * This is the half of the integration we can exercise without an account: we own the
 * secret, so we can produce a request that is indistinguishable from a real one and
 * run it through exactly the code a real transfer would reach. Only the final hop —
 * money actually moving in a bank — needs SePay itself.
 */
export interface SepayTransfer {
  id: number;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  referenceCode?: string;
  description?: string;
}

export function signedWebhook(
  transfer: SepayTransfer,
  secret: string,
  options: { timestamp?: number; tamperBody?: boolean } = {},
): { body: string; headers: Record<string, string> } {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    gateway: 'Vietcombank',
    transactionDate: '2026-10-04 10:00:00',
    accountNumber: '0010000000355',
    referenceCode: `FT${transfer.id}`,
    description: '',
    ...transfer,
  });

  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');

  return {
    // Signed before tampering, so the body on the wire no longer matches — which is
    // the only honest way to test that the signature is actually checked.
    body: options.tamperBody ? body.replace(/"transferAmount":\d+/, '"transferAmount":1') : body,
    headers: {
      'content-type': 'application/json',
      'x-sepay-signature': `sha256=${signature}`,
      'x-sepay-timestamp': String(timestamp),
    },
  };
}
