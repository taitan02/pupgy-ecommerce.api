import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { PasswordResetRepository } from '../repositories/password-reset.repository.js';
import { PasswordService } from './password.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { logger } from '../../../infra/logger/logger.js';
import type { Env } from '../../../config/env.schema.js';

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: PasswordResetRepository,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Always succeeds, whatever the email.
   *
   * Answering differently for a registered and an unregistered address turns this
   * endpoint into an account-existence oracle — which is exactly what someone
   * preparing a credential-stuffing run wants. The caller is told "if that address has
   * an account, a link is on its way" and nothing more.
   */
  async request(email: string, audience: 'STOREFRONT' | 'SELLER'): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'ACTIVE') {
      logger.info({ audience }, 'password reset requested for unknown or suspended account');
      return;
    }

    await this.tokens.invalidateAllForUser(user.id);

    // 32 bytes of CSPRNG output. The URL carries the plaintext; only the hash is
    // stored, so a leaked database yields nothing that can be redeemed.
    const token = randomBytes(32).toString('base64url');
    const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });

    await this.tokens.create({
      id: uuidv7(),
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    await this.notifications.enqueue({ type: 'password-reset', userId: user.id, token, audience });
  }

  /**
   * Redeems a link and sets the new password.
   *
   * Every session goes, in both audiences: the usual reason someone resets a password
   * is that they think somebody else has it, and leaving the intruder's refresh token
   * alive would make the reset theatre (ADR-007).
   */
  async reset(token: string, newPassword: string): Promise<void> {
    const record = await this.tokens.findByTokenHash(sha256(token));

    // One message for missing, expired and already-used: which of the three it is
    // tells an attacker whether they have a real token.
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw AppError.conflict('This reset link is no longer valid. Please request a new one.');
    }

    if (!(await this.tokens.markUsed(record.id))) {
      throw AppError.conflict('This reset link is no longer valid. Please request a new one.');
    }

    await this.users.updatePassword(record.userId, await this.passwords.hash(newPassword));
    const revoked = await this.sessions.revokeAllForUser(record.userId);
    logger.info({ userId: record.userId, revoked }, 'password reset; all sessions revoked');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
