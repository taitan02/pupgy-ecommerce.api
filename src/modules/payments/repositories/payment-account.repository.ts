import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { RequestContext } from '../../../common/context/request-context.js';

export interface PaymentAccountRecord {
  id: string;
  shopId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  webhookId: string;
  webhookSecretCipher: string;
  isActive: boolean;
}

const FIELDS = {
  id: true,
  shopId: true,
  bankCode: true,
  accountNumber: true,
  accountName: true,
  webhookId: true,
  webhookSecretCipher: true,
  isActive: true,
} as const;

@Injectable()
export class PaymentAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Seller side: the shop comes from the request context, never from an argument. */
  findForShop(): Promise<PaymentAccountRecord | null> {
    return this.prisma.shopPaymentAccount.findUnique({
      where: { shopId: RequestContext.requireShopId() },
      select: FIELDS,
    });
  }

  /**
   * Webhook side: resolve the shop from the opaque id in the URL.
   *
   * This runs *before* the signature is verified, which is the point — the secret is
   * per shop, so you cannot verify anything until you know which shop. Nothing from
   * the request body is consulted here (ADR-014).
   */
  findByWebhookId(webhookId: string): Promise<PaymentAccountRecord | null> {
    return this.prisma.shopPaymentAccount.findUnique({
      where: { webhookId },
      select: FIELDS,
    });
  }

  /** Checkout side: may this shop be paid by QR at all? */
  findActiveForShop(shopId: string): Promise<PaymentAccountRecord | null> {
    return this.prisma.shopPaymentAccount.findFirst({
      where: { shopId, isActive: true },
      select: FIELDS,
    });
  }

  upsert(data: {
    id: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    webhookId: string;
    webhookSecretCipher: string;
    isActive: boolean;
  }): Promise<PaymentAccountRecord> {
    const shopId = RequestContext.requireShopId();
    const { id, ...rest } = data;

    return this.prisma.shopPaymentAccount.upsert({
      where: { shopId },
      create: { id, shopId, ...rest },
      // webhookId is not updated: changing it would silently break the URL the
      // merchant already pasted into SePay, and the first symptom would be payments
      // that never arrive.
      update: {
        bankCode: rest.bankCode,
        accountNumber: rest.accountNumber,
        accountName: rest.accountName,
        webhookSecretCipher: rest.webhookSecretCipher,
        isActive: rest.isActive,
      },
      select: FIELDS,
    });
  }
}
