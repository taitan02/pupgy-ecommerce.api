import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { LedgerAccount, LedgerReason } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

export interface NewEntry {
  shopId: string;
  account: LedgerAccount;
  /** Signed. Negative takes money out. */
  amount: number;
  reason: LedgerReason;
  orderId?: string;
  payoutId?: string;
  note?: string;
}

export interface ShopBalance {
  pending: number;
  available: number;
}

export interface LedgerRow {
  id: string;
  account: LedgerAccount;
  amount: number;
  reason: LedgerReason;
  orderId: string | null;
  payoutId: string | null;
  note: string | null;
  createdAt: Date;
}

/**
 * The ledger is append-only. There is no update and no delete here, and that is the
 * point: a mistake is corrected by writing its opposite, so the history of the mistake
 * survives (ADR-015).
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes entries on an existing transaction. Money movements are never the only
   *  thing happening — they accompany an order or a payout, and must commit with it. */
  async post(tx: Prisma.TransactionClient, entries: NewEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await tx.ledgerEntry.createMany({
      data: entries.map((entry) => ({ id: uuidv7(), ...entry })),
    });
  }

  /**
   * A balance is the sum of the entries, computed on demand.
   *
   * Not a stored column: a number that is incremented can be wrong with no way to find
   * out when it went wrong, and from then on every answer derived from it is wrong too.
   * This costs an aggregate over an indexed `(shop_id, account)` — when that stops
   * being cheap the answer is a periodically-materialised snapshot plus the entries
   * since, not a mutable total.
   */
  async balanceOf(shopId: string, tx?: Prisma.TransactionClient): Promise<ShopBalance> {
    const client = tx ?? this.prisma;
    const totals = await client.ledgerEntry.groupBy({
      by: ['account'],
      where: { shopId, account: { in: ['SHOP_PENDING', 'SHOP_AVAILABLE'] } },
      _sum: { amount: true },
    });

    const of = (account: LedgerAccount) =>
      totals.find((row) => row.account === account)?._sum.amount ?? 0;

    return { pending: of('SHOP_PENDING'), available: of('SHOP_AVAILABLE') };
  }

  list(shopId: string, params: { cursor?: string; limit: number }): Promise<LedgerRow[]> {
    return this.prisma.ledgerEntry.findMany({
      where: { shopId, account: { in: ['SHOP_PENDING', 'SHOP_AVAILABLE'] } },
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        account: true,
        amount: true,
        reason: true,
        orderId: true,
        payoutId: true,
        note: true,
        createdAt: true,
      },
    });
  }

  /** Has this order already been settled into the ledger? Guards against a release or
   *  a refund running twice, independently of the order's own flags. */
  async hasEntriesFor(orderId: string, reason: LedgerReason, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const found = await client.ledgerEntry.findFirst({ where: { orderId, reason }, select: { id: true } });
    return found !== null;
  }
}
