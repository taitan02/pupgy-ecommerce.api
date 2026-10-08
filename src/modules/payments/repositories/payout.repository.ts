import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PayoutStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { RequestContext } from '../../../common/context/request-context.js';

export interface PayoutRecord {
  id: string;
  shopId: string;
  amount: number;
  status: PayoutStatus;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  note: string | null;
  requestedAt: Date;
  settledAt: Date | null;
}

const FIELDS = {
  id: true,
  shopId: true,
  amount: true,
  status: true,
  bankCode: true,
  accountNumber: true,
  accountName: true,
  note: true,
  requestedAt: true,
  settledAt: true,
} as const;

export interface PayoutAccountRecord {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- the shop's bank details ----------

  findAccount(): Promise<PayoutAccountRecord | null> {
    return this.prisma.shopPayoutAccount.findUnique({
      where: { shopId: RequestContext.requireShopId() },
      select: { bankCode: true, accountNumber: true, accountName: true },
    });
  }

  upsertAccount(data: { id: string } & PayoutAccountRecord): Promise<PayoutAccountRecord> {
    const shopId = RequestContext.requireShopId();
    const { id, ...rest } = data;
    return this.prisma.shopPayoutAccount.upsert({
      where: { shopId },
      create: { id, shopId, ...rest },
      update: rest,
      select: { bankCode: true, accountNumber: true, accountName: true },
    });
  }

  // ---------- payouts ----------

  /**
   * Creates the request and takes the money out of the available balance in one
   * transaction, with the shop row locked for the duration.
   *
   * The lock is the part that matters, and it is not optional. Everywhere else in this
   * system a race is closed by putting the condition into the write —
   * `WHERE stock >= $1`, `WHERE status = $from`. That works because the quantity being
   * guarded lives in one row. A balance does not: it is the sum of every ledger entry,
   * and there is no row to attach the condition to. Two concurrent requests both read
   * "enough", both insert, and the shop is paid twice.
   *
   * `SELECT ... FOR UPDATE` on the shop makes payout requests for that shop serial.
   * It is held only for this transaction, and nothing else in the system takes it.
   */
  async request(input: {
    id: string;
    shopId: string;
    amount: number;
    account: PayoutAccountRecord;
    postReservation: (tx: Prisma.TransactionClient, payoutId: string) => Promise<void>;
    availableInside: (tx: Prisma.TransactionClient) => Promise<number>;
  }): Promise<PayoutRecord | 'insufficient'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM shops WHERE id = ${input.shopId}::uuid FOR UPDATE`;

      const available = await input.availableInside(tx);
      if (available < input.amount) return 'insufficient' as const;

      const payout = await tx.payout.create({
        data: {
          id: input.id,
          shopId: input.shopId,
          amount: input.amount,
          ...input.account,
        },
        select: FIELDS,
      });

      await input.postReservation(tx, payout.id);
      return payout;
    });
  }

  listForShop(params: { cursor?: string; limit: number }): Promise<PayoutRecord[]> {
    return this.prisma.payout.findMany({
      where: { shopId: RequestContext.requireShopId() },
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: FIELDS,
    });
  }

  findOwned(id: string): Promise<PayoutRecord | null> {
    return this.prisma.payout.findFirst({
      where: { id, shopId: RequestContext.requireShopId() },
      select: FIELDS,
    });
  }
}
