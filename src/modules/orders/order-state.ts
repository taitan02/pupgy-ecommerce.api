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
export type Actor = 'BUYER' | 'SELLER';

const TRANSITIONS: Record<OrderStatus, { to: OrderStatus; by: Actor[] }[]> = {
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

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from].some((edge) => edge.to === to && edge.by.includes(actor));
}

/** What the client may offer as buttons, so the UI never renders an action that 409s. */
export function allowedTransitions(from: OrderStatus, actor: Actor): OrderStatus[] {
  return TRANSITIONS[from].filter((edge) => edge.by.includes(actor)).map((edge) => edge.to);
}

/** Cancelling before delivery gives the units back; after it, there is nothing to give. */
export const RESTOCKS_ON_CANCEL: OrderStatus[] = ['PENDING', 'CONFIRMED'];

const TIMESTAMP_COLUMN = {
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
