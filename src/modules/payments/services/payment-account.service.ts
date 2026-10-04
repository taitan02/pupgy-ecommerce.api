import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret, encryptSecret, keyFromBase64 } from '../../../common/crypto/secret-box.js';
import {
  PaymentAccountRepository,
  type PaymentAccountRecord,
} from '../repositories/payment-account.repository.js';
import type { PaymentAccountDto, UpsertPaymentAccountDto } from '../dto/payment.dto.js';
import type { Env } from '../../../config/env.schema.js';

@Injectable()
export class PaymentAccountService {
  private readonly key: Buffer;

  constructor(
    private readonly accounts: PaymentAccountRepository,
    private readonly config: ConfigService<Env, true>,
  ) {
    // Decoded once at construction: a bad key should stop the process starting, not
    // surface as a failed webhook at 2am.
    this.key = keyFromBase64(config.get('ENCRYPTION_KEY', { infer: true }));
  }

  async get(): Promise<PaymentAccountDto | null> {
    const account = await this.accounts.findForShop();
    return account ? this.toDto(account) : null;
  }

  async upsert(dto: UpsertPaymentAccountDto): Promise<PaymentAccountDto> {
    const existing = await this.accounts.findForShop();

    if (!existing && !dto.webhookSecret) {
      throw AppError.conflict('A webhook secret is required the first time you set this up');
    }

    const saved = await this.accounts.upsert({
      id: existing?.id ?? uuidv7(),
      bankCode: dto.bankCode.trim(),
      accountNumber: dto.accountNumber.trim(),
      accountName: dto.accountName.trim().toUpperCase(),
      // Kept across updates: changing it would break the URL already pasted into
      // SePay, and the first symptom would be payments that silently never arrive.
      webhookId: existing?.webhookId ?? randomBytes(24).toString('base64url'),
      webhookSecretCipher: dto.webhookSecret
        ? encryptSecret(dto.webhookSecret, this.key)
        : existing!.webhookSecretCipher,
      isActive: dto.isActive ?? true,
    });

    return this.toDto(saved);
  }

  /** Used by the webhook path, which has already resolved the shop from the URL. */
  secretOf(account: PaymentAccountRecord): string {
    return decryptSecret(account.webhookSecretCipher, this.key);
  }

  private toDto(account: PaymentAccountRecord): PaymentAccountDto {
    return {
      bankCode: account.bankCode,
      // The full number is only ever needed to build a QR, which the API does itself.
      // Seller Center shows enough to recognise it and no more.
      accountNumberMasked: `••••${account.accountNumber.slice(-4)}`,
      accountName: account.accountName,
      webhookUrl: `${this.config.get('API_PUBLIC_URL', { infer: true })}/api/v1/webhooks/sepay/${account.webhookId}`,
      hasSecret: account.webhookSecretCipher.length > 0,
      isActive: account.isActive,
    };
  }
}
