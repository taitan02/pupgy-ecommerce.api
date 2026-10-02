import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

export interface PasswordResetRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

@Injectable()
export class PasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetRecord> {
    return this.prisma.passwordResetToken.create({
      data: input,
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  /**
   * Redeems the token, returning false if somebody already did.
   *
   * `usedAt: null` is part of the WHERE clause rather than a check beforehand: two
   * requests carrying the same link would both pass a prior check, and the second
   * would reset the password again — with whatever it was sent, which need not be
   * what the first one set.
   */
  async markUsed(id: string): Promise<boolean> {
    const result = await this.prisma.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }

  /** Asking for a new link invalidates the outstanding ones, so a link found in an
   *  old email cannot be used after a fresh one was requested. */
  async invalidateAllForUser(userId: string): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
