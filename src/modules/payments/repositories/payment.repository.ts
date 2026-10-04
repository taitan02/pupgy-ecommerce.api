import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

export interface PaymentRecord {
  id: string;
  orderId: string;
  shopId: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  reference: string;
  expiresAt: Date;
  paidAt: Date | null;
  providerTransactionId: string | null;
}

const FIELDS = {
  id: true,
  orderId: true,
  shopId: true,
  amount: true,
  status: true,
  reference: true,
  expiresAt: true,
  paidAt: true,
  providerTransactionId: true,
} as const;

/** The outcome of handing a webhook to the repository. Every one of these is a normal
 *  thing that happens in production, which is why none of them is an exception. */
export type SettlementResult =
  | { outcome: 'paid'; payment: PaymentRecord }
  | { outcome: 'duplicate' }
  | { outcome: 'no-match' }
  | { outcome: 'amount-mismatch'; expected: number; received: number }
  | { outcome: 'not-pending'; status: PaymentRecord['status'] };

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    id: string;
    orderId: string;
    shopId: string;
    amount: number;
    reference: string;
    expiresAt: Date;
  }): Promise<PaymentRecord> {
    return this.prisma.payment.create({ data, select: FIELDS });
  }

  findByOrder(orderId: string): Promise<PaymentRecord | null> {
    return this.prisma.payment.findUnique({ where: { orderId }, select: FIELDS });
  }

  /**
   * Settles one verified webhook: records the event, matches it to a pending payment,
   * marks it paid and moves the order — all in one transaction.
   *
   * The deduplication is the unique index on (shop, provider transaction id), not a
   * prior lookup. SePay retries up to seven times over five hours, so two deliveries
   * landing at once is ordinary; a check-then-write would let both through and pay the
   * same order twice. The second insert loses, and losing is a success here — the
   * money was already recorded.
   */
  async settle(input: {
    shopId: string;
    providerTransactionId: string;
    amount: number;
    memo: string;
    payload: Prisma.InputJsonValue;
    matchReference: (memo: string, reference: string) => boolean;
  }): Promise<SettlementResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.payment.findMany({
          where: { shopId: input.shopId, status: 'PENDING' },
          orderBy: { id: 'desc' },
          // The memo decides which one; this bound just stops an unmatched transfer
          // from scanning a shop's entire history.
          take: 200,
          select: FIELDS,
        });

        const payment = candidates.find((row) => input.matchReference(input.memo, row.reference));

        await tx.paymentEvent.create({
          data: {
            id: uuidv7(),
            shopId: input.shopId,
            providerTransactionId: input.providerTransactionId,
            payload: input.payload,
            paymentId: payment?.id ?? null,
          },
        });

        // An unmatched transfer is still recorded above: it is evidence, and somebody
        // will eventually ask what happened to their money.
        if (!payment) return { outcome: 'no-match' } as const;

        if (payment.amount !== input.amount) {
          return {
            outcome: 'amount-mismatch',
            expected: payment.amount,
            received: input.amount,
          } as const;
        }

        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            providerTransactionId: input.providerTransactionId,
          },
        });
        if (claimed.count === 0) return { outcome: 'not-pending', status: payment.status } as const;

        await tx.order.updateMany({
          where: { id: payment.orderId, status: 'AWAITING_PAYMENT' },
          data: { status: 'PENDING', paymentStatus: 'PAID' },
        });

        return { outcome: 'paid', payment } as const;
      });
    } catch (error) {
      // P2002 on (shop, transaction id): another delivery of the same webhook got
      // there first and the whole transaction rolled back. Nothing to do.
      if (isUniqueViolation(error)) return { outcome: 'duplicate' };
      throw error;
    }
  }

  /** Payments whose window has closed and whose order is still unpaid. Bounded,
   *  because a sweeper that tries to fix everything at once fixes nothing. */
  findExpired(limit: number): Promise<PaymentRecord[]> {
    return this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: limit,
      select: FIELDS,
    });
  }

  /** Closes the payment, with the current status in the WHERE clause so a transfer
   *  that arrived in the same second cannot be overwritten by the sweeper. */
  async markExpired(id: string): Promise<boolean> {
    const result = await this.prisma.payment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    return result.count === 1;
  }

  async markCancelled(orderId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}
