import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v7 as uuidv7 } from 'uuid';
import { SessionRepository } from '../repositories/session.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { logger } from '../../../infra/logger/logger.js';
import type { Env } from '../../../config/env.schema.js';
import type { TokenAudience } from '../../../generated/prisma/enums.js';
import type { AccessTokenPayload } from '../auth.types.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** New login: starts a fresh token family. */
  async issue(userId: string, audience: TokenAudience, client: ClientInfo): Promise<IssuedTokens> {
    return this.mint(userId, audience, uuidv7(), client);
  }

  /**
   * Exchanges a refresh token for a new pair.
   *
   * Rotation + reuse detection: each token is valid exactly once. Presenting a spent
   * token means either a stolen token is being replayed or the real client is
   * retrying — we cannot tell them apart, so we take the safe reading and revoke the
   * whole family. The user logs in again; an attacker gets nothing.
   */
  async rotate(presentedToken: string, client: ClientInfo): Promise<IssuedTokens> {
    const session = await this.sessions.findByTokenHash(hashToken(presentedToken));

    if (!session) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Invalid refresh token');
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Refresh token is no longer valid');
    }

    const claimed = await this.sessions.markUsed(session.id);
    if (!claimed && !(await this.isBenignRetry(presentedToken))) {
      const revoked = await this.sessions.revokeFamily(session.familyId);
      logger.warn(
        { userId: session.userId, familyId: session.familyId, revoked },
        'refresh token reuse detected — session family revoked',
      );
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Refresh token reuse detected');
    }

    return this.mint(session.userId, session.audience, session.familyId, client);
  }

  /**
   * Two browser tabs (or a React StrictMode double-effect) can refresh with the same
   * cookie within milliseconds of each other. That is not an attack, but it is
   * indistinguishable from one, so we allow a short window after a token was spent:
   * inside it the retry gets a new token in the same family, outside it the family is
   * revoked. The cost is that a token stolen and replayed within this window goes
   * undetected — a deliberate trade against logging real users out constantly.
   */
  private async isBenignRetry(presentedToken: string): Promise<boolean> {
    const graceMs = this.config.get('REFRESH_REUSE_GRACE_MS', { infer: true });
    if (graceMs <= 0) return false;

    const current = await this.sessions.findByTokenHash(hashToken(presentedToken));
    if (!current?.usedAt || current.revokedAt) return false;

    return Date.now() - current.usedAt.getTime() <= graceMs;
  }

  async revokeFamilyOf(presentedToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(hashToken(presentedToken));
    if (session) {
      await this.sessions.revokeFamily(session.familyId);
    }
  }

  private async mint(
    userId: string,
    audience: TokenAudience,
    familyId: string,
    client: ClientInfo,
  ): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = { sub: userId, aud: audience, jti: familyId };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get('ACCESS_TOKEN_TTL', { infer: true }),
    });

    // 32 random bytes, not a JWT: opaque, revocable, and useless if the database
    // leaks because only its SHA-256 is stored.
    const refreshToken = randomBytes(32).toString('base64url');
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const refreshExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.sessions.create({
      id: uuidv7(),
      familyId,
      userId,
      tokenHash: hashToken(refreshToken),
      audience,
      expiresAt: refreshExpiresAt,
      userAgent: client.userAgent?.slice(0, 255),
      ip: client.ip?.slice(0, 45),
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }
}

/** Plain SHA-256, not argon2: this is a 256-bit random value, not a guessable
 *  password, so there is nothing for an attacker to brute-force. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
