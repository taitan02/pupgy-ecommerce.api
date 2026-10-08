import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { logger } from '../../../infra/logger/logger.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { PaymentRepository } from '../repositories/payment.repository.js';
import { EscrowService } from './escrow.service.js';
import { memoContains } from './transfer-memo.js';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySepaySignature } from './sepay-signature.js';
import type { Env } from '../../../config/env.schema.js';

/** The fields of SePay's payload this code uses. The rest lives in the raw event row. */
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
    private readonly payments: PaymentRepository,
    private readonly escrow: EscrowService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * One SePay account, the platform's (ADR-015), so the secret comes from the
   * environment rather than from a row. The verification itself is unchanged from
   * ADR-014 — it never depended on who owned the account.
   *
   * Nothing slow happens here: SePay expects an answer inside 30 seconds, so the emails
   * go to the queue.
   */
  async handle(input: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<void> {
    const secret = this.config.get('SEPAY_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      // An unset secret disables the endpoint rather than accepting unsigned callbacks.
      // Failing closed is the only safe default for a thing that moves money.
      logger.error('SEPAY_WEBHOOK_SECRET is not set — refusing every webhook');
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Webhook not configured');
    }

    const failure = verifySepaySignature({
      rawBody: input.rawBody,
      signatureHeader: header(input.headers, SIGNATURE_HEADER),
      timestampHeader: header(input.headers, TIMESTAMP_HEADER),
      secret,
    });

    if (failure) {
      logger.warn({ failure }, 'rejected SePay webhook');
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Invalid signature');
    }

    const payload = JSON.parse(input.rawBody.toString('utf8')) as SepayPayload;

    // Money leaving the account is not a payment. Recording it would match a payment by
    // memo and settle it on the strength of a refund going out.
    if (payload.transferType !== 'in') return;

    const providerTransactionId = String(payload.id ?? payload.referenceCode ?? '');
    const amount = Number(payload.transferAmount ?? 0);
    if (!providerTransactionId || !Number.isFinite(amount) || amount <= 0) {
      logger.warn('SePay webhook without a usable id or amount');
      return;
    }

    const memo = [payload.content, payload.description].filter(Boolean).join(' ');

    const result = await this.payments.settle({
      providerTransactionId,
      amount,
      memo,
      payload: payload as object,
      matchReference: memoContains,
      // Inside the settling transaction: the money is held for each shop at the same
      // moment its orders become payable, or neither happens (ADR-015).
      onPaid: (tx, orders) => this.escrow.hold(tx, orders),
    });

    switch (result.outcome) {
      case 'paid':
        for (const order of result.orders) {
          await this.notifications.enqueue({ type: 'order-status', orderId: order.id, status: 'PENDING' });
          await this.notifications.enqueue({ type: 'order-received', orderId: order.id });
        }
        logger.info(
          { paymentId: result.payment.id, orders: result.orders.length, amount },
          'payment settled into escrow',
        );
        return;

      case 'duplicate':
        logger.info({ providerTransactionId }, 'duplicate SePay webhook');
        return;

      // Money that arrived and could not be applied. All are recorded as events; none
      // is an error to SePay, because retrying will not change the outcome.
      case 'no-match':
        logger.warn({ memo, amount }, 'transfer matched no pending payment');
        return;

      case 'amount-mismatch':
        logger.warn(
          { expected: result.expected, received: result.received },
          'transfer amount does not match the payment',
        );
        return;

      case 'not-pending':
        logger.warn({ status: result.status }, 'payment was no longer pending');
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
