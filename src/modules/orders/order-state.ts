import type { OrderStatus } from '../../generated/prisma/enums.js';

/**
 * The order lifecycle, in one place (ADR-012).
 *
 * Linear forward, with CANCELLED as the only exit, and only before the parcel leaves:
 * once a courier has it, "cancelled" is a return, which is a different process with
 * different money attached.
 *
 * Who may do what is part of the transition, not a separate check, because the same
 * target state means different things depending on who asks: a buyer cancelling a
 * PENDING order is changing their mind, a seller cancelling it is refusing the sale.
 */
/**
 * `SYSTEM` is not a user with a bigger hammer — it is the only actor allowed to make
 * the two moves nobody should be able to make by hand: accepting a verified payment,
 * and expiring an order that was never paid for.
 */
export type Actor = 'BUYER' | 'SELLER' | 'SYSTEM';

const TRANSITIONS: Record<OrderStatus, { to: OrderStatus; by: Actor[] }[]> = {
  AWAITING_PAYMENT: [
    // Only a verified webhook moves an order out of here. No seller button, no admin
    // override: "mark as paid" is how money goes missing (ADR-014).
    { to: 'PENDING', by: ['SYSTEM'] },
    // The buyer changing their mind, or the expiry job closing the window. Both
    // restock, because placement already took the units.
    { to: 'CANCELLED', by: ['BUYER', 'SYSTEM'] },
  ],
  PENDING: [
    { to: 'CONFIRMED', by: ['SELLER'] },
    { to: 'CANCELLED', by: ['BUYER', 'SELLER'] },
  ],
  CONFIRMED: [
    { to: 'SHIPPING', by: ['SELLER'] },
    // The buyer loses the right to cancel here: the shop has committed stock and is
    // packing. Cancelling after that is a conversation, not a button.
    { to: 'CANCELLED', by: ['SELLER'] },
  ],
  SHIPPING: [{ to: 'DELIVERED', by: ['SELLER'] }],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Payment is a second axis the table above cannot express.
 *
 * A buyer may walk away from an unpaid order freely. Once they have transferred, the
 * money is already in the shop's bank account and the platform never touched it
 * (ADR-001) — so "cancel" means "refund me", which is a conversation with the shop and
 * something only the shop can carry out. The button disappears rather than failing.
 */
function isAllowed(from: OrderStatus, to: OrderStatus, actor: Actor, paid: boolean): boolean {
  if (paid && actor === 'BUYER' && to === 'CANCELLED') return false;
  return TRANSITIONS[from].some((edge) => edge.to === to && edge.by.includes(actor));
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: Actor,
  paid = false,
): boolean {
  return isAllowed(from, to, actor, paid);
}

/** What the client may offer as buttons, so the UI never renders an action that 409s. */
export function allowedTransitions(from: OrderStatus, actor: Actor, paid = false): OrderStatus[] {
  return TRANSITIONS[from]
    .filter((edge) => edge.by.includes(actor) && isAllowed(from, edge.to, actor, paid))
    .map((edge) => edge.to);
}

/** Cancelling before delivery gives the units back; after it, there is nothing to give.
 *  AWAITING_PAYMENT is in the list because stock is taken at placement, not at
 *  payment — the expiry is the reservation (ADR-014). */
export const RESTOCKS_ON_CANCEL: OrderStatus[] = ['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'];

const TIMESTAMP_COLUMN = {
  // AWAITING_PAYMENT has no column: it is where a QR order starts, and `placedAt`
  // already records when.
  CONFIRMED: 'confirmedAt',
  SHIPPING: 'shippedAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
} as const;

/** Each state stamps its own column, so "when was this shipped?" is a read, not a
 *  reconstruction from an audit log we do not keep. */
export function timestampColumnFor(status: OrderStatus): string | null {
  return status in TIMESTAMP_COLUMN
    ? TIMESTAMP_COLUMN[status as keyof typeof TIMESTAMP_COLUMN]
    : null;
}
