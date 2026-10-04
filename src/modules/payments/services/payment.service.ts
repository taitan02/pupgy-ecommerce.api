import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '../../../common/errors/app-error.js';
import { logger } from '../../../infra/logger/logger.js';
import { PaymentRepository, type PaymentRecord } from '../repositories/payment.repository.js';
import { PaymentAccountRepository } from '../repositories/payment-account.repository.js';
import { PaymentQueue } from './payment.queue.js';
import type { PaymentInstructionsDto } from '../dto/payment.dto.js';
import type { Env } from '../../../config/env.schema.js';

@Injectable()
export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly accounts: PaymentAccountRepository,
    private readonly queue: PaymentQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Opens the payment window for a freshly placed QR order and arms its expiry. */
  async open(orderId: string, shopId: string, amount: number, reference: string): Promise<void> {
    const minutes = this.config.get('PAYMENT_EXPIRY_MINUTES', { infer: true });
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    await this.payments.create({ id: uuidv7(), orderId, shopId, amount, reference, expiresAt });

    // A delayed job *and* a periodic sweeper, because a delayed job can be lost — a
    // Redis flush, a queue drained during an incident — and a lost one here means an
    // order holding stock forever (architecture pack §5.2).
    await this.queue.scheduleExpiry(orderId, minutes * 60_000);
  }

  /**
   * What the buyer needs in order to pay. The QR is built here rather than stored,
   * because it is entirely derived — the account, the amount and the reference are all
   * already rows, and a cached image would be one more thing to invalidate.
   */
  async instructionsFor(payment: PaymentRecord): Promise<PaymentInstructionsDto> {
    const account = await this.accounts.findActiveForShop(payment.shopId);
    if (!account) throw AppError.notFound('This shop can no longer be paid by transfer');

    const query = new URLSearchParams({
      acc: account.accountNumber,
      bank: account.bankCode,
      amount: String(payment.amount),
      des: payment.reference,
    });

    return {
      qrImageUrl: `https://qr.sepay.vn/img?${query.toString()}`,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      amount: payment.amount,
      reference: payment.reference,
      expiresAt: payment.expiresAt.toISOString(),
      status: payment.status,
    };
  }

  findByOrder(orderId: string): Promise<PaymentRecord | null> {
    return this.payments.findByOrder(orderId);
  }

  /** The buyer cancelled the order themselves; the window closes with it. */
  async cancelForOrder(orderId: string): Promise<void> {
    await this.payments.markCancelled(orderId);
  }

  /**
   * Closes one expired payment. Returns the order to cancel, or null when the payment
   * is no longer pending — which is the normal outcome of a transfer that arrived
   * while the sweeper was already running.
   */
  async expire(paymentId: string, orderId: string): Promise<string | null> {
    if (!(await this.payments.markExpired(paymentId))) {
      logger.info({ paymentId }, 'payment was settled before it could expire');
      return null;
    }
    return orderId;
  }

  /** The sweeper's view: everything whose window has closed, bounded. */
  findExpired(limit = 100): Promise<PaymentRecord[]> {
    return this.payments.findExpired(limit);
  }
}
