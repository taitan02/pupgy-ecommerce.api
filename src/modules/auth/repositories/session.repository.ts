import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { TokenAudience } from '../../../generated/prisma/enums.js';

export interface SessionRecord {
  id: string;
  familyId: string;
  userId: string;
  audience: TokenAudience;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    id: string;
    familyId: string;
    userId: string;
    tokenHash: string;
    audience: TokenAudience;
    expiresAt: Date;
    userAgent?: string;
    ip?: string;
  }): Promise<SessionRecord> {
    return this.prisma.session.create({
      data: input,
      select: {
        id: true,
        familyId: true,
        userId: true,
        audience: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
  }

  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        familyId: true,
        userId: true,
        audience: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Marks a token as spent. The `usedAt: null` condition makes this the atomic step
   * of rotation: two concurrent refreshes race here, and exactly one updates a row.
   * The loser gets 0 and is treated as reuse, which is the correct conservative call.
   */
  async markUsed(id: string): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }

  /** A reused token means the family is compromised: kill all of its descendants. */
  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
