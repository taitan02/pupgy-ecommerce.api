import type { OrderStatus } from '../../generated/prisma/enums.js';

export const MAIL_QUEUE = 'mail';

/**
 * What a mail job carries: ids and nothing else (ADR-013).
 *
 * A job is written now and may run minutes later after two retries. A payload that
 * carried the rendered email would send a message describing a world that has since
 * moved on — "shop đã xác nhận đơn" arriving after the shop cancelled it. The worker
 * re-reads and renders at send time instead.
 *
 * It also keeps names, addresses and prices out of Redis.
 */
export type MailJob =
  | { type: 'order-placed'; orderId: string }
  | { type: 'order-status'; orderId: string; status: OrderStatus }
  | { type: 'order-received'; orderId: string }
  | { type: 'password-reset'; userId: string; token: string; audience: 'STOREFRONT' | 'SELLER' };

/**
 * One job per (thing, event). BullMQ refuses a duplicate id while the job is active
 * or still in the completed window, so an endpoint called twice by an impatient
 * seller sends one email.
 *
 * Separated by `-`, not `:`: BullMQ builds its Redis keys with colons and rejects an
 * id containing one. It rejects it at `add` time, and enqueue failures are swallowed
 * on purpose (an email must not fail a checkout) — so a colon here would disable
 * every email in the system without a single failing request.
 *
 * The reset token is deliberately part of this key: two reset requests are two
 * different links, and the second must not be swallowed as a duplicate of the first.
 */
export function jobIdFor(job: MailJob): string {
  switch (job.type) {
    case 'order-placed':
      return `order-placed-${job.orderId}`;
    case 'order-received':
      return `order-received-${job.orderId}`;
    case 'order-status':
      return `order-status-${job.orderId}-${job.status}`;
    case 'password-reset':
      return `password-reset-${job.token.slice(0, 16)}`;
  }
}
