import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { logger } from '../../../infra/logger/logger.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { PaymentAccountRepository } from '../repositories/payment-account.repository.js';
import { PaymentRepository } from '../repositories/payment.repository.js';
import { PaymentAccountService } from './payment-account.service.js';
import { memoContains } from './transfer-memo.js';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySepaySignature,
} from './sepay-signature.js';

/** The fields of SePay's payload this code actually uses. Everything else is kept in
 *  the raw event row rather than typed here. */
interface SepayPayload {
  id?: number | string;
  transferType?: string;
  transferAmount?: number;
  content?: string;
  description?: string;
  referenceCode?: string;
}

@Injectable()
export class SepayWebhookService {
  constructor(
    private readonly accounts: PaymentAccountRepository,
    private readonly accountService: PaymentAccountService,
    private readonly payments: PaymentRepository,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Everything a verified webhook does, in order. The order is the design:
   *
   * 1. resolve the shop from the **URL**, because the secret is per shop and nothing
   *    in the body may be trusted yet;
   * 2. verify the signature over the **raw bytes** that arrived;
   * 3. only then look at the payload.
   *
   * Nothing slow happens on this path — SePay expects an answer inside 30 seconds, so
   * the receipt email goes to the queue like every other email.
   */
  async handle(input: {
    webhookId: string;
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<void> {
    const account = await this.accounts.findByWebhookId(input.webhookId);
    // 404, not 401: an unknown URL should look like an unknown URL. Telling a prober
    // that a webhook id exists but their signature was wrong is free information.
    if (!account) throw AppError.notFound('Unknown webhook');

    const failure = verifySepaySignature({
      rawBody: input.rawBody,
      signatureHeader: header(input.headers, SIGNATURE_HEADER),
      timestampHeader: header(input.headers, TIMESTAMP_HEADER),
      secret: this.accountService.secretOf(account),
    });

    if (failure) {
      // Logged with the shop, because a burst of these is either a misconfigured
      // secret after a rotation or somebody probing — and the two look different in
      // volume, not in shape.
      logger.warn({ shopId: account.shopId, failure }, 'rejected SePay webhook');
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Invalid signature');
    }

    const payload = JSON.parse(input.rawBody.toString('utf8')) as SepayPayload;

    // Money leaving the account is not a payment. Recording it would match an order by
    // memo and mark it paid on the strength of a refund.
    if (payload.transferType !== 'in') return;

    const providerTransactionId = String(payload.id ?? payload.referenceCode ?? '');
    const amount = Number(payload.transferAmount ?? 0);
    if (!providerTransactionId || !Number.isFinite(amount) || amount <= 0) {
      logger.warn({ shopId: account.shopId }, 'SePay webhook without a usable id or amount');
      return;
    }

    const memo = [payload.content, payload.description].filter(Boolean).join(' ');

    const result = await this.payments.settle({
      shopId: account.shopId,
      providerTransactionId,
      amount,
      memo,
      payload: payload as object,
      matchReference: memoContains,
    });

    switch (result.outcome) {
      case 'paid':
        await this.notifications.enqueue({
          type: 'order-status',
          orderId: result.payment.orderId,
          status: 'PENDING',
        });
        await this.notifications.enqueue({ type: 'order-received', orderId: result.payment.orderId });
        logger.info({ orderId: result.payment.orderId, amount }, 'payment settled');
        return;

      case 'duplicate':
        // SePay retried. The first delivery already did the work.
        logger.info({ shopId: account.shopId, providerTransactionId }, 'duplicate SePay webhook');
        return;

      // The remaining cases are money that arrived and could not be applied. All are
      // recorded as events; none is an error to SePay, because retrying will not change
      // the outcome and a human has to look at them.
      case 'no-match':
        logger.warn({ shopId: account.shopId, memo, amount }, 'transfer matched no pending payment');
        return;

      case 'amount-mismatch':
        logger.warn(
          { shopId: account.shopId, expected: result.expected, received: result.received },
          'transfer amount does not match the order',
        );
        return;

      case 'not-pending':
        logger.warn({ shopId: account.shopId, status: result.status }, 'payment was no longer pending');
        return;
    }
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}
