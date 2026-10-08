import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { logger } from '../../../infra/logger/logger.js';
import { PaymentRepository, type PaymentRecord } from '../repositories/payment.repository.js';
import { PaymentQueue } from './payment.queue.js';
import { generatePaymentCode } from './payment-code.js';
import type { PaymentInstructionsDto } from '../dto/payment.dto.js';
import type { Env } from '../../../config/env.schema.js';

@Injectable()
export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly queue: PaymentQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Opens one payment window covering the given orders.
   *
   * The orders stay per shop — each ships its own parcel — but a buyer makes one
   * transfer, so the money is unified (ADR-015).
   */
  async open(input: {
    buyerId: string;
    orders: { id: string; total: number }[];
  }): Promise<PaymentRecord> {
    const minutes = this.config.get('PAYMENT_EXPIRY_MINUTES', { infer: true });
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    const payment = await this.payments.create({
      id: uuidv7(),
      code: generatePaymentCode(),
      buyerId: input.buyerId,
      amount: input.orders.reduce((sum, order) => sum + order.total, 0),
      expiresAt,
      orderIds: input.orders.map((order) => order.id),
    });

    // A delayed job *and* a periodic sweeper: a delayed job can be lost, and a lost one
    // here means orders holding stock forever (architecture pack §5.2).
    await this.queue.scheduleExpiry(payment.id, minutes * 60_000);
    return payment;
  }

  /**
   * What the buyer needs in order to pay. Derived, not stored: the account, the amount
   * and the code are all already rows, and a cached QR would be one more thing to
   * invalidate.
   */
  instructionsFor(payment: PaymentRecord): PaymentInstructionsDto {
    const accountNumber = this.config.get('SEPAY_ACCOUNT_NUMBER', { infer: true });
    const bankCode = this.config.get('SEPAY_BANK_CODE', { infer: true });

    const query = new URLSearchParams({
      acc: accountNumber,
      bank: bankCode,
      amount: String(payment.amount),
      des: payment.code,
    });

    return {
      qrImageUrl: `https://qr.sepay.vn/img?${query.toString()}`,
      bankCode,
      accountNumber,
      accountName: this.config.get('SEPAY_ACCOUNT_NAME', { infer: true }),
      amount: payment.amount,
      reference: payment.code,
      expiresAt: payment.expiresAt.toISOString(),
      status: payment.status,
    };
  }

  findById(id: string): Promise<PaymentRecord | null> {
    return this.payments.findById(id);
  }

  findForOrder(orderId: string): Promise<PaymentRecord | null> {
    return this.payments.findForOrder(orderId);
  }

  /** The buyer cancelled an order; its payment window closes with it. */
  async cancelForOrder(orderId: string): Promise<void> {
    await this.payments.markCancelledForOrder(orderId);
  }

  /**
   * Closes one expired payment. Returns the orders to cancel, or an empty list when the
   * payment is no longer pending — the normal outcome of a transfer that arrived while
   * the sweeper was already running.
   */
  async expire(paymentId: string): Promise<string[]> {
    if (!(await this.payments.markExpired(paymentId))) {
      logger.info({ paymentId }, 'payment was settled before it could expire');
      return [];
    }
    const orders = await this.payments.ordersOf(paymentId);
    return orders.map((order) => order.id);
  }

  findExpired(limit = 100): Promise<PaymentRecord[]> {
    return this.payments.findExpired(limit);
  }
}
