import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

export interface PaymentRecord {
  id: string;
  code: string;
  buyerId: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  expiresAt: Date;
  paidAt: Date | null;
  providerTransactionId: string | null;
}

/** An order as the settlement path needs it. */
export interface CoveredOrder {
  id: string;
  shopId: string;
  total: number;
  itemsSubtotal: number;
  commissionRate: number;
  paymentMethod: 'COD' | 'SEPAY_QR';
}

const FIELDS = {
  id: true,
  code: true,
  buyerId: true,
  amount: true,
  status: true,
  expiresAt: true,
  paidAt: true,
  providerTransactionId: true,
} as const;

const COVERED_ORDER = {
  id: true,
  shopId: true,
  total: true,
  itemsSubtotal: true,
  commissionRate: true,
  paymentMethod: true,
} as const;

export type SettlementResult =
  | { outcome: 'paid'; payment: PaymentRecord; orders: CoveredOrder[] }
  | { outcome: 'duplicate' }
  | { outcome: 'no-match' }
  | { outcome: 'amount-mismatch'; expected: number; received: number }
  | { outcome: 'not-pending'; status: PaymentRecord['status'] };

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    id: string;
    code: string;
    buyerId: string;
    amount: number;
    expiresAt: Date;
    orderIds: string[];
  }): Promise<PaymentRecord> {
    const { orderIds, ...payment } = data;
    return this.prisma.payment.create({
      data: { ...payment, orders: { connect: orderIds.map((id) => ({ id })) } },
      select: FIELDS,
    });
  }

  findById(id: string): Promise<PaymentRecord | null> {
    return this.prisma.payment.findUnique({ where: { id }, select: FIELDS });
  }

  findForOrder(orderId: string): Promise<PaymentRecord | null> {
    return this.prisma.payment
      .findFirst({ where: { orders: { some: { id: orderId } } }, select: FIELDS });
  }

  ordersOf(paymentId: string, tx?: Prisma.TransactionClient): Promise<CoveredOrder[]> {
    return (tx ?? this.prisma).order.findMany({
      where: { paymentId },
      select: COVERED_ORDER,
    });
  }

  /**
   * Settles one verified webhook inside a single transaction: record the event, match a
   * pending payment by its code, mark it paid and move every order it covers.
   *
   * The deduplication is the unique index on the provider transaction id, not a prior
   * lookup. SePay retries up to seven times over five hours, so two deliveries landing
   * together is ordinary — and a check-then-write would credit the same money twice.
   */
  async settle(input: {
    providerTransactionId: string;
    amount: number;
    memo: string;
    payload: Prisma.InputJsonValue;
    matchReference: (memo: string, reference: string) => boolean;
    onPaid: (tx: Prisma.TransactionClient, orders: CoveredOrder[]) => Promise<void>;
  }): Promise<SettlementResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.payment.findMany({
          where: { status: 'PENDING' },
          orderBy: { id: 'desc' },
          take: 500,
          select: FIELDS,
        });

        const payment = candidates.find((row) => input.matchReference(input.memo, row.code));

        await tx.paymentEvent.create({
          data: {
            id: uuidv7(),
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
          where: { paymentId: payment.id, status: 'AWAITING_PAYMENT' },
          data: { status: 'PENDING', paymentStatus: 'PAID' },
        });

        const orders = await this.ordersOf(payment.id, tx);
        // The ledger is written here, in the same transaction that moved the orders.
        await input.onPaid(tx, orders);

        return { outcome: 'paid', payment, orders } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { outcome: 'duplicate' };
      throw error;
    }
  }

  findExpired(limit: number): Promise<PaymentRecord[]> {
    return this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: limit,
      select: FIELDS,
    });
  }

  /** Closes the window, with the current status in the WHERE clause so a transfer that
   *  arrived in the same second cannot be overwritten by the sweeper. */
  async markExpired(id: string): Promise<boolean> {
    const result = await this.prisma.payment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    return result.count === 1;
  }

  async markCancelledForOrder(orderId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { orders: { some: { id: orderId } }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}
